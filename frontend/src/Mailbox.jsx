/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  Forward,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Paperclip,
  Plus,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import EmailHtmlViewer from './EmailHtmlViewer';
import EmailComposer from './EmailComposer';
import {
  clearMailboxApiCache,
  isQuotaError,
  mailboxGet,
  mailboxSend,
  quotaRetryAfter,
} from './mailboxApi';
import './Mailbox.css';

const FOLDERS = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'all', label: 'All Mail', icon: Mail },
  { key: 'sent', label: 'Sent', icon: Send },
  { key: 'drafts', label: 'Drafts', icon: FileText },
  { key: 'starred', label: 'Starred', icon: Star },
  { key: 'archive', label: 'Archive', icon: Archive },
  { key: 'spam', label: 'Spam', icon: AlertTriangle },
  { key: 'trash', label: 'Trash', icon: Trash2 },
];

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatFullDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseAddress(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^"?([^"<]*)"?\s*<([^>]+)>/);
  if (match) {
    return { name: match[1].trim() || match[2], email: match[2].trim() };
  }
  return { name: raw, email: raw };
}

function replySubject(subject) {
  const clean = String(subject || '').trim();
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean || '(no subject)'}`;
}

function forwardSubject(subject) {
  const clean = String(subject || '').trim();
  return /^fwd?\s*:/i.test(clean) ? clean : `Fwd: ${clean || '(no subject)'}`;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function attachmentUrl(attachment) {
  return `/api/mailbox/attachments/${encodeURIComponent(attachment.messageId)}/${encodeURIComponent(attachment.attachmentId)}` +
    `?mime=${encodeURIComponent(attachment.mimeType || 'application/octet-stream')}` +
    `&filename=${encodeURIComponent(attachment.filename || 'attachment')}`;
}

export default function Mailbox() {
  const [folder, setFolder] = useState('inbox');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [threads, setThreads] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [profile, setProfile] = useState(null);
  const [counts, setCounts] = useState(null);

  const [selectedSummary, setSelectedSummary] = useState(null);
  const [selectedThread, setSelectedThread] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const [compose, setCompose] = useState(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null);
  const composerRef = useRef(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const [quota, setQuota] = useState(null);
  const [quotaRemaining, setQuotaRemaining] = useState(0);

  const handleQuota = useCallback((err) => {
    if (!isQuotaError(err)) return false;
    const retryAfter = quotaRetryAfter(err);
    setQuota({
      message: (err.data && err.data.message) || err.message || 'Gmail rate limit reached.',
      until: Date.now() + retryAfter * 1000,
    });
    setQuotaRemaining(retryAfter);
    return true;
  }, []);

  useEffect(() => {
    if (!quota) {
      setQuotaRemaining(0);
      return undefined;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((quota.until - Date.now()) / 1000));
      setQuotaRemaining(remaining);
      if (remaining <= 0) setQuota(null);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [quota]);

  const fetchProfile = useCallback(async (force = false) => {
    try {
      const data = await mailboxGet(
        `/api/mailbox/profile${force ? '?refresh=1' : ''}`,
        { ttlSeconds: 60, force }
      );
      setProfile(data);
    } catch (err) {
      if (!handleQuota(err)) setProfile({ error: err.message });
    }
  }, [handleQuota]);

  const fetchCounts = useCallback(async (force = false) => {
    try {
      const data = await mailboxGet(
        `/api/mailbox/counts${force ? '?refresh=1' : ''}`,
        { ttlSeconds: 120, force }
      );
      setCounts(data.counts);
      if (data.capabilities) {
        setProfile(prev => (prev ? { ...prev, ...data.capabilities } : prev));
      }
    } catch (err) {
      handleQuota(err);
    }
  }, [handleQuota]);

  useEffect(() => {
    fetchProfile();
    fetchCounts();

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchCounts();
    }, 5 * 60 * 1000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchCounts();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchProfile, fetchCounts]);

  const fetchThreads = useCallback(async (reset = false, pageToken = null, force = false) => {
    setListLoading(true);
    setListError('');
    try {
      const params = new URLSearchParams({
        folder,
        limit: '10',
      });
      if (search) params.set('q', search);
      if (pageToken) params.set('pageToken', pageToken);
      if (force) params.set('refresh', '1');

      const data = await mailboxGet(
        `/api/mailbox/threads?${params.toString()}`,
        { ttlSeconds: 45, force }
      );

      setThreads(prev => reset ? (data.threads || []) : [...prev, ...(data.threads || [])]);
      setNextPageToken(data.nextPageToken || null);
    } catch (err) {
      if (!handleQuota(err)) setListError(err.message);
      if (reset) setThreads([]);
    } finally {
      setListLoading(false);
    }
  }, [folder, search, handleQuota]);

  useEffect(() => {
    setSelectedSummary(null);
    setSelectedThread(null);
    setDetailError('');
    fetchThreads(true);
  }, [folder, search, fetchThreads]);

  const refreshAll = useCallback(async () => {
    if (quotaRemaining > 0) return;
    setQuota(null);
    clearMailboxApiCache();
    await Promise.all([
      fetchProfile(true),
      fetchCounts(true),
      fetchThreads(true, null, true),
    ]);
    if (selectedSummary?.threadId) {
      try {
        const data = await mailboxGet(
          `/api/mailbox/threads/${encodeURIComponent(selectedSummary.threadId)}?refresh=1`,
          { ttlSeconds: 0, force: true }
        );
        setSelectedThread(data.thread);
      } catch (err) {
        handleQuota(err);
      }
    }
  }, [fetchThreads, fetchCounts, fetchProfile, selectedSummary, quotaRemaining, handleQuota]);

  const loadThread = useCallback(async (summary, force = false) => {
    setSelectedSummary(summary);
    setDetailLoading(true);
    setDetailError('');
    setSelectedThread(null);
    try {
      const data = await mailboxGet(
        `/api/mailbox/threads/${encodeURIComponent(summary.threadId)}${force ? '?refresh=1' : ''}`,
        { ttlSeconds: 30, force }
      );
      setSelectedThread(data.thread);
    } catch (err) {
      if (!handleQuota(err)) setDetailError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }, [handleQuota]);

  const applyAction = useCallback(async (threadId, action) => {
    if (!threadId) return;
    if (['trash', 'spam'].includes(action) && !window.confirm(`Move this conversation to ${action}?`)) return;
    setActionBusy(action);
    try {
      const data = await mailboxSend(
        `/api/mailbox/threads/${encodeURIComponent(threadId)}/modify`,
        'POST',
        { action }
      );
      clearMailboxApiCache();

      setThreads(prev => prev.map(item => item.threadId === threadId ? {
        ...item,
        unreadCount: data.unreadCount,
        isUnread: data.isUnread,
        isStarred: data.isStarred,
      } : item));

      if (['archive', 'trash', 'spam', 'untrash', 'unspam', 'unarchive'].includes(action)) {
        setThreads(prev => prev.filter(item => item.threadId !== threadId));
        if (selectedSummary?.threadId === threadId) {
          setSelectedSummary(null);
          setSelectedThread(null);
        }
        const actionLabels = {
          archive: 'archived',
          trash: 'moved to trash',
          spam: 'moved to spam',
          untrash: 'restored',
          unspam: 'restored',
          unarchive: 'restored',
        };
        showToast(`Conversation ${actionLabels[action] || 'updated'}`);
      } else {
        showToast(
          action === 'read' ? 'Marked as read' :
            action === 'unread' ? 'Marked as unread' :
              action === 'star' ? 'Starred' :
                action === 'unstar' ? 'Unstarred' : 'Updated'
        );
        if (selectedSummary?.threadId === threadId) {
          setSelectedThread(prev => prev ? {
            ...prev,
            unreadCount: data.unreadCount,
            isUnread: data.isUnread,
            isStarred: data.isStarred,
          } : prev);
        }
      }
    } catch (err) {
      if (!handleQuota(err)) showToast(err.message, 'error');
    } finally {
      setActionBusy('');
    }
  }, [selectedSummary, showToast, handleQuota]);

  useEffect(() => {
    if (compose && ['reply', 'replyAll', 'forward'].includes(compose.mode)) {
      window.requestAnimationFrame(() => {
        composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [compose]);

  const openCompose = useCallback((mode) => {
    if (!selectedThread) return;
    const last = selectedThread.messages[selectedThread.messages.length - 1];
    if (!last) return;

    if (mode === 'reply' || mode === 'replyAll') {
      const from = parseAddress(last.replyTo || last.from);
      const ownEmail = String(profile?.emailAddress || '').toLowerCase();
      const primaryEmail = from.email.toLowerCase();
      const cc = mode === 'replyAll'
        ? [last.to, last.cc]
          .join(',')
          .split(',')
          .map(value => value.trim())
          .filter(value => {
            const lower = value.toLowerCase();
            return value && !lower.includes(ownEmail) && !lower.includes(primaryEmail);
          })
          .join(', ')
        : '';
      setCompose({
        mode,
        to: from.email,
        cc,
        bcc: '',
        subject: replySubject(selectedThread.subject),
        body: '',
        attachments: [],
        threadId: selectedThread.threadId,
        includeOriginalAttachments: true,
        replyAll: mode === 'replyAll',
      });
      return;
    }

    if (mode === 'forward') {
      setCompose({
        mode: 'forward',
        to: '',
        cc: '',
        bcc: '',
        subject: forwardSubject(selectedThread.subject),
        body: '',
        attachments: [],
        threadId: selectedThread.threadId,
        includeOriginalAttachments: true,
      });
      return;
    }

    if (mode === 'draft') {
      setCompose({
        mode: 'new',
        draftId: selectedThread.draftId || null,
        to: last.to || '',
        cc: last.cc || '',
        bcc: last.bcc || '',
        subject: last.subject || selectedThread.subject || '',
        body: last.text || '',
        attachments: [],
        threadId: selectedThread.threadId,
        includeOriginalAttachments: false,
      });
    }
  }, [selectedThread, profile]);

  const openNewCompose = useCallback(() => {
    setCompose({
      mode: 'new',
      to: '',
      cc: '',
      bcc: '',
      subject: '',
      body: '',
      attachments: [],
      threadId: null,
      includeOriginalAttachments: false,
    });
  }, []);

  const closeCompose = useCallback(() => {
    if (sending) return;
    setCompose(null);
  }, [sending]);

  const handleFiles = useCallback(async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;

    const currentTotal = (compose?.attachments || []).reduce((sum, item) => sum + (item.size || 0), 0);
    const newTotal = files.reduce((sum, file) => sum + file.size, 0);
    if (currentTotal + newTotal > 20 * 1024 * 1024) {
      showToast('Attachments exceed the 20 MB limit for a single message.', 'error');
      return;
    }

    try {
      const items = [];
      for (const file of files) {
        const dataBase64 = await readFileAsBase64(file);
        items.push({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          dataBase64,
          size: file.size,
        });
      }
      setCompose(prev => prev ? { ...prev, attachments: [...prev.attachments, ...items] } : prev);
    } catch (err) {
      showToast(`Could not read attachment: ${err.message}`, 'error');
    }
  }, [compose, showToast]);

  const removeAttachment = useCallback((index) => {
    setCompose(prev => prev ? {
      ...prev,
      attachments: prev.attachments.filter((_, idx) => idx !== index),
    } : prev);
  }, []);

  const composePayload = useCallback(() => ({
    to: compose.to,
    cc: compose.cc,
    bcc: compose.bcc,
    subject: compose.subject,
    body: compose.body,
    attachments: compose.attachments,
  }), [compose]);

  const sendCompose = useCallback(async () => {
    if (!compose) return;
    if (!compose.to.trim()) {
      showToast('Recipient (To) is required.', 'error');
      return;
    }
    if (!compose.subject.trim()) {
      showToast('Subject is required.', 'error');
      return;
    }
    if (!compose.body.trim()) {
      showToast('Email body is required.', 'error');
      return;
    }

    setSending(true);
    try {
      const payload = composePayload();

      if (compose.mode === 'reply' || compose.mode === 'replyAll') {
        await mailboxSend(
          `/api/mailbox/threads/${encodeURIComponent(compose.threadId)}/reply`,
          'POST',
          {
            ...payload,
            replyAll: compose.mode === 'replyAll',
            includeOriginalAttachments: compose.includeOriginalAttachments,
          }
        );
      } else if (compose.mode === 'forward') {
        await mailboxSend(
          `/api/mailbox/threads/${encodeURIComponent(compose.threadId)}/forward`,
          'POST',
          {
            ...payload,
            includeOriginalAttachments: compose.includeOriginalAttachments,
          }
        );
      } else if (compose.draftId) {
        const saveData = await mailboxSend('/api/mailbox/drafts', 'POST', {
          ...payload,
          draftId: compose.draftId,
          threadId: compose.threadId || undefined,
        });
        await mailboxSend(
          `/api/mailbox/drafts/${encodeURIComponent(saveData.draftId)}/send`,
          'POST',
          {}
        );
      } else {
        await mailboxSend('/api/mailbox/send', 'POST', payload);
      }

      clearMailboxApiCache();
      showToast('Email sent and saved in Gmail.');
      setCompose(null);
      fetchThreads(true);
      fetchCounts();
    } catch (err) {
      if (!handleQuota(err)) showToast(err.message, 'error');
    } finally {
      setSending(false);
    }
  }, [compose, composePayload, showToast, fetchThreads, fetchCounts, handleQuota]);

  const saveDraft = useCallback(async () => {
    if (!compose) return;
    setSending(true);
    try {
      const payload = composePayload();
      const data = await mailboxSend('/api/mailbox/drafts', 'POST', {
        ...payload,
        draftId: compose.draftId || undefined,
        threadId: compose.threadId || undefined,
      });
      clearMailboxApiCache();
      setCompose(prev => prev ? { ...prev, draftId: data.draftId } : prev);
      showToast('Draft saved in Gmail.');
      fetchCounts();
    } catch (err) {
      if (!handleQuota(err)) showToast(err.message, 'error');
    } finally {
      setSending(false);
    }
  }, [compose, composePayload, showToast, fetchCounts, handleQuota]);

  const sendExistingDraft = useCallback(async (draftId) => {
    if (!draftId) return;
    setActionBusy('sendDraft');
    try {
      await mailboxSend(`/api/mailbox/drafts/${encodeURIComponent(draftId)}/send`, 'POST', {});
      clearMailboxApiCache();
      showToast('Draft sent.');
      await refreshAll();
    } catch (err) {
      if (!handleQuota(err)) showToast(err.message, 'error');
    } finally {
      setActionBusy('');
    }
  }, [refreshAll, showToast, handleQuota]);

  const deleteExistingDraft = useCallback(async (draftId) => {
    if (!draftId || !window.confirm('Delete this draft?')) return;
    setActionBusy('deleteDraft');
    try {
      await mailboxSend(`/api/mailbox/drafts/${encodeURIComponent(draftId)}`, 'DELETE');
      clearMailboxApiCache();
      showToast('Draft deleted.');
      setSelectedSummary(null);
      setSelectedThread(null);
      await refreshAll();
    } catch (err) {
      if (!handleQuota(err)) showToast(err.message, 'error');
    } finally {
      setActionBusy('');
    }
  }, [refreshAll, showToast, handleQuota]);

  const folderCount = (key) => {
    if (!counts) return '';
    const item = counts[key];
    if (!item) return '';
    if (key === 'inbox' || key === 'trash' || key === 'spam') return item.unread || '';
    return item.total || '';
  };

  const authWarning = profile && (profile.needsAuth || profile.canSend === false || profile.error);

  return (
    <div className="mailbox-page">
      <div className="mailbox-toolbar">
        <div>
          <h2>Mailbox</h2>
          <p>
            {profile?.emailAddress
              ? `${profile.emailAddress} â€” live Gmail mailbox`
              : 'Connect to the shared Gmail mailbox'}
          </p>
        </div>
        <div className="mailbox-toolbar-actions">
          <button className="btn btn-secondary" onClick={refreshAll} disabled={listLoading || quotaRemaining > 0}>
            <RefreshCw size={14} className={listLoading ? 'spinner' : ''} />
            Refresh
          </button>
          <button className="btn btn-primary" onClick={openNewCompose}>
            <Plus size={14} />
            Compose
          </button>
        </div>
      </div>

      {authWarning && (
        <div className="mailbox-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>Gmail write access is not authorized.</strong>
            <div>
              Run <code>node Backend/scripts/gmail-authorize.js</code>, sign in, then restart the backend.
              Sending and mark read/unread will fall back to SMTP until this is done.
            </div>
          </div>
        </div>
      )}

      {quotaRemaining > 0 && (
        <div className="mailbox-warning mailbox-quota-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>Gmail rate limit reached.</strong>
            <div>
              {quota?.message || 'Too many Gmail requests.'} Retrying in {quotaRemaining}s.
              Please wait; repeated refreshes will extend the delay.
            </div>
          </div>
        </div>
      )}

      <div className="mailbox-shell">
        <aside className="mailbox-folders">
          {FOLDERS.map(item => {
            const Icon = item.icon;
            const count = folderCount(item.key);
            return (
              <button
                key={item.key}
                className={`mailbox-folder ${folder === item.key ? 'active' : ''}`}
                onClick={() => setFolder(item.key)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
                {count !== '' && <span className="mailbox-folder-count">{count}</span>}
              </button>
            );
          })}
        </aside>

        <section className="mailbox-list">
          <div className="mailbox-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${folder === 'all' ? 'all mail' : folder}...`}
            />
            {query && (
              <button onClick={() => setQuery('')} title="Clear search">
                <X size={14} />
              </button>
            )}
          </div>

          {listError && <div className="mailbox-empty error">{listError}</div>}

          {listLoading && threads.length === 0 ? (
            <div className="mailbox-loading">
              <Loader2 size={22} className="spinner" />
              Loading {folder}...
            </div>
          ) : threads.length === 0 && !listError ? (
            <div className="mailbox-empty">No conversations in {folder}.</div>
          ) : (
            <div className="mailbox-thread-list">
              {threads.map(item => (
                <button
                  key={item.threadId}
                  className={`mailbox-thread ${item.isUnread ? 'unread' : ''} ${selectedSummary?.threadId === item.threadId ? 'selected' : ''}`}
                  onClick={() => loadThread(item)}
                >
                  <div className="mailbox-thread-top">
                    <span className="mailbox-unread-dot" />
                    <span className="mailbox-thread-sender">{parseAddress(item.from).name}</span>
                    <span className="mailbox-thread-date">{formatDate(item.date)}</span>
                  </div>
                  <div className="mailbox-thread-subject">{item.subject}</div>
                  <div className="mailbox-thread-snippet">{item.snippet}</div>
                  <div className="mailbox-thread-meta">
                    {item.isStarred && <Star size={12} className="starred" />}
                    {item.hasAttachments && <Paperclip size={12} />}
                    {item.unreadCount > 0 && <span>{item.unreadCount > 1 ? `${item.unreadCount} unread` : 'Unread'}</span>}
                    {item.messageCount > 1 && <span>{item.messageCount} messages</span>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {nextPageToken && (
            <button
              className="mailbox-load-more"
              onClick={() => fetchThreads(false, nextPageToken)}
              disabled={listLoading || quotaRemaining > 0}
            >
              {listLoading ? 'Loading...' : 'Load more'}
            </button>
          )}
        </section>

        <section className="mailbox-detail">
          {!selectedSummary && !detailLoading && (
            <div className="mailbox-detail-empty">
              <MailOpen size={42} />
              <h3>Select a conversation</h3>
              <p>Read, reply, forward, star, archive, or delete mail without leaving the portal.</p>
            </div>
          )}

          {detailLoading && (
            <div className="mailbox-loading">
              <Loader2 size={26} className="spinner" />
              Loading conversation...
            </div>
          )}

          {detailError && <div className="mailbox-empty error">{detailError}</div>}

          {selectedThread && !detailLoading && (
            <>
              <div className="mailbox-detail-header">
                <div className="mailbox-detail-title">
                  <h3>{selectedThread.subject}</h3>
                  <span>{selectedThread.messageCount} message{selectedThread.messageCount === 1 ? '' : 's'}</span>
                </div>
                <div className="mailbox-detail-actions">
                  <button
                    title={selectedThread.isUnread ? 'Mark as read' : 'Mark as unread'}
                    onClick={() => applyAction(selectedThread.threadId, selectedThread.isUnread ? 'read' : 'unread')}
                    disabled={Boolean(actionBusy) || quotaRemaining > 0}
                  >
                    {selectedThread.isUnread ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                  <button
                    title={selectedThread.isStarred ? 'Unstar' : 'Star'}
                    onClick={() => applyAction(selectedThread.threadId, selectedThread.isStarred ? 'unstar' : 'star')}
                    disabled={Boolean(actionBusy) || quotaRemaining > 0}
                  >
                    <Star size={15} className={selectedThread.isStarred ? 'starred' : ''} />
                  </button>
                  <button
                    title="Archive"
                    onClick={() => applyAction(selectedThread.threadId, 'archive')}
                    disabled={Boolean(actionBusy) || quotaRemaining > 0}
                  >
                    <Archive size={15} />
                  </button>
                  <button
                    title="Move to spam"
                    onClick={() => applyAction(selectedThread.threadId, 'spam')}
                    disabled={Boolean(actionBusy) || quotaRemaining > 0}
                  >
                    <AlertTriangle size={15} />
                  </button>
                  <button
                    title="Move to trash"
                    onClick={() => applyAction(selectedThread.threadId, 'trash')}
                    disabled={Boolean(actionBusy) || quotaRemaining > 0}
                  >
                    <Trash2 size={15} />
                  </button>
                  <a
                    href={`https://mail.google.com/mail/u/0/#all/${selectedThread.threadId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in Gmail"
                  >
                    <Mail size={15} />
                  </a>
                </div>
              </div>

              <div className="mailbox-reply-bar">
                <button className="btn btn-primary" onClick={() => openCompose('reply')}>
                  <Reply size={14} />
                  Reply
                </button>
                <button className="btn btn-secondary" onClick={() => openCompose('replyAll')}>
                  <ReplyAll size={14} />
                  Reply All
                </button>
                <button className="btn btn-secondary" onClick={() => openCompose('forward')}>
                  <Forward size={14} />
                  Forward
                </button>
                {selectedThread.draftId && (
                  <>
                    <button className="btn btn-secondary" onClick={() => openCompose('draft')}>
                      <Edit3 size={14} />
                      Edit Draft
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => sendExistingDraft(selectedThread.draftId)}
                      disabled={actionBusy === 'sendDraft'}
                    >
                      <Send size={14} />
                      Send Draft
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => deleteExistingDraft(selectedThread.draftId)}
                      disabled={actionBusy === 'deleteDraft'}
                    >
                      <Trash2 size={14} />
                      Delete Draft
                    </button>
                  </>
                )}
              </div>

              <div className="mailbox-messages">
                {selectedThread.messages.map((message, index) => (
                  <article className="mailbox-message" key={message.id || index}>
                    <div className="mailbox-message-head">
                      <div>
                        <strong>{parseAddress(message.from).name}</strong>
                        <span>{message.from}</span>
                      </div>
                      <div>
                        <span>{formatFullDate(message.date)}</span>
                        {message.isStarred && <Star size={12} className="starred" />}
                      </div>
                    </div>
                    <div className="mailbox-message-recipients">
                      <span><strong>To:</strong> {message.to || 'â€”'}</span>
                      {message.cc && <span><strong>Cc:</strong> {message.cc}</span>}
                    </div>
                    <EmailHtmlViewer
                      html={message.html}
                      text={message.text}
                      title={`Message ${index + 1}`}
                      height={380}
                    />
                    {(message.attachments || []).filter(a => !a.inline).length > 0 && (
                      <div className="mailbox-attachments">
                        <div className="mailbox-attachments-title">
                          <Paperclip size={13} />
                          Attachments
                        </div>
                        {message.attachments.filter(a => !a.inline).map(attachment => (
                          <a
                            key={attachment.attachmentId}
                            href={attachmentUrl({ ...attachment, messageId: message.id })}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mailbox-attachment"
                          >
                            <Download size={13} />
                            <span>{attachment.filename}</span>
                            <small>{attachment.size ? `${Math.round(attachment.size / 1024)} KB` : ''}</small>
                          </a>
                        ))}
                      </div>
                    )}

                  </article>
                ))}
              </div>

              {compose && ['reply', 'replyAll', 'forward'].includes(compose.mode) && (
                <div ref={composerRef}>
                  <EmailComposer
                    key={`inline-${compose.mode}`}
                    variant="inline"
                    compose={compose}
                    onChange={(patch) => setCompose(prev => prev ? { ...prev, ...patch } : prev)}
                    onSend={sendCompose}
                    onSaveDraft={saveDraft}
                    onDiscard={closeCompose}
                    onFiles={handleFiles}
                    onRemoveAttachment={removeAttachment}
                    sending={sending}
                    profileEmail={profile?.emailAddress}
                    quotaRemaining={quotaRemaining}
                  />
                </div>
              )}

              {selectedThread.draftId && (
                <div className="mailbox-draft-note">
                  <FileText size={14} />
                  This conversation is a draft. Use <strong>Edit Draft</strong> or <strong>Send Draft</strong> above.
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {compose && !['reply', 'replyAll', 'forward'].includes(compose.mode) && (
        <EmailComposer
          key={`docked-${compose.mode}-${compose.draftId || 'new'}`}
          variant="docked"
          compose={compose}
          onChange={(patch) => setCompose(prev => prev ? { ...prev, ...patch } : prev)}
          onSend={sendCompose}
          onSaveDraft={saveDraft}
          onDiscard={closeCompose}
          onFiles={handleFiles}
          onRemoveAttachment={removeAttachment}
          sending={sending}
          profileEmail={profile?.emailAddress}
          quotaRemaining={quotaRemaining}
        />
      )}

      {toast && (
        <div className={`mailbox-toast ${toast.type === 'error' ? 'error' : ''}`}>
          {toast.type === 'error' ? <AlertTriangle size={15} /> : <Check size={15} />}
          {toast.message}
        </div>
      )}
    </div>
  );
}




