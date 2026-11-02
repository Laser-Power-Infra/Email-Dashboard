import { useState } from 'react';
import {
  Check,
  ChevronUp,
  FileText,
  Forward,
  Loader2,
  Minus,
  Paperclip,
  Reply,
  ReplyAll,
  Send,
  X,
} from 'lucide-react';
import RecipientInput from './RecipientInput';
import './EmailComposer.css';

function composerTitle(mode) {
  if (mode === 'reply') return 'Reply';
  if (mode === 'replyAll') return 'Reply all';
  if (mode === 'forward') return 'Forward';
  return 'New message';
}

function composerIcon(mode) {
  if (mode === 'reply') return <Reply size={14} />;
  if (mode === 'replyAll') return <ReplyAll size={14} />;
  if (mode === 'forward') return <Forward size={14} />;
  return <FileText size={14} />;
}

export default function EmailComposer({
  variant = 'inline',
  compose,
  onChange,
  onSend,
  onSaveDraft,
  onDiscard,
  onFiles,
  onRemoveAttachment,
  sending = false,
  profileEmail = '',
  quotaRemaining = 0,
}) {
  const [showCc, setShowCc] = useState(Boolean(compose.cc));
  const [showBcc, setShowBcc] = useState(Boolean(compose.bcc));
  const [minimized, setMinimized] = useState(false);

  if (!compose) return null;

  const isReply = compose.mode === 'reply' || compose.mode === 'replyAll';
  const isForward = compose.mode === 'forward';
  const isDocked = variant === 'docked';
  const fileInputId = `composer-files-${variant}`;

  return (
    <section className={`composer composer-${variant} ${minimized ? 'is-minimized' : ''}`}>
      <header className="composer-head">
        <div className="composer-head-title">
          {composerIcon(compose.mode)}
          <span>{composerTitle(compose.mode)}</span>
          {profileEmail && <small>{profileEmail}</small>}
        </div>
        <div className="composer-head-actions">
          {isDocked && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMinimized(prev => !prev)}
              title={minimized ? 'Expand' : 'Minimize'}
            >
              {minimized ? <ChevronUp size={14} /> : <Minus size={14} />}
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onDiscard} title="Discard">
            <X size={14} />
          </button>
        </div>
      </header>

      {!minimized && (
        <>
          <div className="composer-fields">
            <label className="composer-row">
              <span>To</span>
              <RecipientInput
                value={compose.to || ''}
                onChange={(to) => onChange({ to })}
                placeholder="recipient@example.com"
              />
              <button
                type="button"
                className="composer-link"
                onClick={() => setShowCc(prev => !prev)}
              >
                Cc
              </button>
              <button
                type="button"
                className="composer-link"
                onClick={() => setShowBcc(prev => !prev)}
              >
                Bcc
              </button>
            </label>

            {(showCc || compose.cc) && (
              <label className="composer-row">
                <span>Cc</span>
                <RecipientInput
                  value={compose.cc || ''}
                  onChange={(cc) => onChange({ cc })}
                  placeholder="cc@example.com"
                />
              </label>
            )}

            {(showBcc || compose.bcc) && (
              <label className="composer-row">
                <span>Bcc</span>
                <RecipientInput
                  value={compose.bcc || ''}
                  onChange={(bcc) => onChange({ bcc })}
                  placeholder="bcc@example.com"
                />
              </label>
            )}

            <label className="composer-row">
              <span>Subject</span>
              <input
                value={compose.subject}
                onChange={(event) => onChange({ subject: event.target.value })}
                placeholder="Subject"
                type="text"
              />
            </label>
          </div>

          <textarea
            className="composer-body"
            rows={isDocked ? 11 : 8}
            value={compose.body}
            onChange={(event) => onChange({ body: event.target.value })}
            placeholder="Write your message..."
          />

          {(isReply || isForward) && (
            <label className="composer-check">
              <input
                type="checkbox"
                checked={Boolean(compose.includeOriginalAttachments)}
                onChange={(event) => onChange({ includeOriginalAttachments: event.target.checked })}
              />
              Include original attachments
            </label>
          )}

          <div className="composer-attachments">
            <div className="composer-attachment-actions">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => document.getElementById(fileInputId)?.click()}
              >
                <Paperclip size={12} />
                Attach files
              </button>
              <span>Maximum 20 MB</span>
              <input
                id={fileInputId}
                type="file"
                multiple
                hidden
                onChange={onFiles}
              />
            </div>
            {compose.attachments && compose.attachments.length > 0 && (
              <div className="composer-file-list">
                {compose.attachments.map((attachment, index) => (
                  <div className="composer-file" key={`${attachment.name}-${index}`}>
                    <Paperclip size={12} />
                    <span>{attachment.name}</span>
                    <small>{Math.round((attachment.size || 0) / 1024)} KB</small>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => onRemoveAttachment(index)}
                      title="Remove attachment"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {quotaRemaining > 0 && (
            <div className="composer-note">
              Gmail rate limit active. Sending is unavailable for {quotaRemaining}s.
            </div>
          )}

          <footer className="composer-foot">
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={onSend}
              disabled={sending || quotaRemaining > 0}
            >
              {sending ? <Loader2 size={12} className="spinner" /> : <Send size={12} />}
              {sending ? 'Sending...' : 'Send'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={onSaveDraft}
              disabled={sending || quotaRemaining > 0}
            >
              Save draft
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={onDiscard}
              disabled={sending}
            >
              Discard
            </button>
            {compose.draftId && (
              <span className="composer-status">
                <Check size={12} /> Draft saved
              </span>
            )}
          </footer>
        </>
      )}
    </section>
  );
}
