// Match Emails Portal v1.2.1
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  FileText,
  Mail,
  Settings,
  RefreshCw,
  Search,
  AlertCircle,
  CheckCircle2,
  Database,
  Key,
  Info,
  ExternalLink,
  User,
  Calendar,
  DollarSign,
  TrendingUp,
  Maximize2,
  Clock,
  Briefcase,
  Send,
  Paperclip,
  Zap,
  ShieldAlert,
  Upload,
  Trash2,
  Edit3,
  Building2,
  Filter,
  Grid,
  Layers,
  X
} from 'lucide-react';

function parseEmailThread(body, defaultSender = 'Sender') {
  if (!body || !body.trim()) return [];

  const text = body.trim();

  // Pattern 1: Outlook/Standard inline split by "From: Name Sent: Date To: Recipient..."
  const rawSplits = text.split(/(?:^|\r?\n)(?:_{3,}|-{3,})?\s*From:\s*/i);

  if (rawSplits.length > 1) {
    const messages = [];

    // First portion before the first "From:"
    let firstPart = rawSplits[0].trim();
    firstPart = firstPart.replace(/^--- Message\s+\d+\s+From:\s*.*?---\s*/gi, '').trim();

    if (firstPart.length > 0) {
      messages.push({
        sender: defaultSender,
        date: '',
        to: '',
        cc: '',
        subject: '',
        text: firstPart,
        body: firstPart
      });
    }

    for (let i = 1; i < rawSplits.length; i++) {
      const partClean = rawSplits[i].trim();
      if (!partClean) continue;

      let sender = '';
      let date = '';
      let to = '';
      let cc = '';
      let subject = '';
      let msgBody = partClean;

      // Locate Subject: header bound
      const subMatch = partClean.match(/Subject:\s*([^\r\n]+)/i);
      let headerEnd = partClean.length;
      if (subMatch) {
        subject = subMatch[1].trim();
        const subIdx = partClean.search(/Subject:\s*/i);
        if (subIdx !== -1) {
          headerEnd = subIdx + subMatch[0].length;
        }
      }

      const headerPortion = partClean.substring(0, headerEnd);
      msgBody = partClean.substring(headerEnd).trim();

      // Extract Sender
      const senderMatch = headerPortion.match(/^([^\r\n;]+?)(?=\s+(?:Sent|Date|To|Cc|Subject):|$)/i);
      if (senderMatch) {
        sender = senderMatch[1].replace(/[<>]/g, '').trim();
      }

      // Extract Date
      const dateMatch = headerPortion.match(/(?:Sent|Date):\s*([^\r\n;]+?)(?=\s+(?:To|Cc|Subject):|$)/i);
      if (dateMatch) {
        date = dateMatch[1].trim();
      }

      // Extract To
      const toMatch = headerPortion.match(/To:\s*([^\r\n;]+?)(?=\s+(?:Cc|Subject):|$)/i);
      if (toMatch) {
        to = toMatch[1].replace(/[<>]/g, '').trim();
      }

      // Extract Cc
      const ccMatch = headerPortion.match(/Cc:\s*([^\r\n;]+?)(?=\s+Subject:|$)/i);
      if (ccMatch) {
        cc = ccMatch[1].replace(/[<>]/g, '').trim();
      }

      messages.push({
        sender: sender || defaultSender,
        date,
        to,
        cc,
        subject,
        text: msgBody || partClean,
        body: msgBody || partClean
      });
    }

    if (messages.length > 0) return messages;
  }

  // Pattern 2: "--- Message X From: Y ---"
  const msgFromRegex = /--- Message\s+\d+\s+From:\s*(.*?)\s*---/gi;
  const matches = [];
  let m;
  while ((m = msgFromRegex.exec(body)) !== null) {
    matches.push({
      index: m.index,
      length: m[0].length,
      sender: m[1]
    });
  }

  if (matches.length > 0) {
    const segments = [];
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const nextIndex = (i + 1 < matches.length) ? matches[i + 1].index : body.length;
      let textSeg = body.substring(current.index + current.length, nextIndex).trim();
      textSeg = textSeg.replace(/---------- Forwarded message ---------/gi, '').trim();

      if (textSeg.length > 0) {
        segments.push({
          sender: current.sender || defaultSender,
          date: '',
          to: '',
          cc: '',
          subject: '',
          text: textSeg,
          body: textSeg
        });
      }
    }
    if (segments.length > 0) return segments;
  }

  // Fallback: Return single main message
  return [{
    sender: defaultSender,
    date: '',
    to: '',
    cc: '',
    subject: '',
    text: body.trim(),
    body: body.trim()
  }];
}

function autoFormatUnstructuredText(text) {
  if (!text || typeof text !== 'string') return '';

  let t = text.trim();
  // 1. Strip leading quotes like "> "
  t = t.replace(/^\s*>\s*/gm, '');

  // 2. Clean prefix headers
  t = t.replace(/^--- Message \d+ From:.*?---\s*/gi, '');

  // 3. Insert line breaks before Greetings / Salutations
  t = t.replace(/\s+(?=(?:\*?Greetings|\*?Dear Sir|Dear Madam|Dear Mr|Dear Mrs))/gi, '\n\n');

  // 4. Insert line breaks before Table Headers (*SL No.*, SL No., Material Description)
  t = t.replace(/\s+(?=(?:\*?SL\s+No\.\*?|\*?Location\*?|\*?Material Description\*?|\*?UOM\*?|\*?QTY\*?))/gi, '\n');

  // 5. Insert line breaks before numbered table rows (e.g. " 1 WTP Koraput", " 2 Intake Well", " 1 DIGITAL TEMPERTURE")
  t = t.replace(/\s+(?=\d+\s+(?:WTP|Intake|Substation|Panel|Transformer|Scheme|[A-Z][a-z0-9]+ Scheme|[A-Z]{2,}\b|\d+ SQ|DIGITAL|MCB|HRC|MPCB|POWER|SWITCH|COMPENSATING|PID|MOTOR|BATTERY))/g, '\n');

  // 6. Insert line breaks before TOTAL / GRAND TOTAL
  t = t.replace(/\s+(?=(?:\*?TOTAL\*?|\*?GRAND TOTAL\*?))/gi, '\n');

  // 7. Insert line breaks before Commercial Terms / Conditions headers
  t = t.replace(/\s+(?=(?:Other commercial terms|Terms and conditions|\*?Share the GTP\*?|GST -|QUOTE VALIDITY|DELIVERY -|PAYMENT TERMS))/gi, '\n\n');

  // 8. Insert line breaks before numbered list items (e.g. " 1. Please submit", " 2. Delivery period:")
  t = t.replace(/\s+(?=\d+\.\s+[A-Z])/g, '\n');

  // 9. Insert line breaks before Notes, Regards, Signatures
  t = t.replace(/\s+(?=(?:Note:|Regards|\*?Thanks & Regards\*?|Sensitivity:|\*?L&T Construction\*?|Mrs\.\s+Dhwani|\*POWER ELECTRONICS\*))/gi, '\n\n');

  // 10. Collapse 3+ newlines into double newlines
  t = t.replace(/(\r?\n){3,}/g, '\n\n');

  return t.trim();
}

function extractCssFromText(text) {
  if (!text) return { css: '', cleanText: '' };

  let cssBlocks = [];
  let cleanTextLines = [];
  let lines = text.split(/\r?\n/);
  let inCss = false;
  let braceCount = 0;
  let currentBlock = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!inCss) {
      const hasOpenBrace = trimmed.includes('{');
      const isCssStart = hasOpenBrace && (
        trimmed.startsWith('.') || 
        trimmed.startsWith('#') || 
        trimmed.startsWith('@') || 
        trimmed.startsWith('[') ||
        trimmed.includes(':') ||
        ['html', 'body', 'div', 'p', 'span', 'table', 'tr', 'td', 'th', 'a', 'img', 'ul', 'li'].some(tag => trimmed.startsWith(tag))
      );

      if (isCssStart) {
        inCss = true;
        braceCount = (trimmed.match(/\{/g) || []).length - (trimmed.match(/\}/g) || []).length;
        currentBlock.push(line);
      } else {
        cleanTextLines.push(line);
      }
    } else {
      currentBlock.push(line);
      braceCount += (trimmed.match(/\{/g) || []).length - (trimmed.match(/\}/g) || []).length;
      if (braceCount <= 0) {
        inCss = false;
        cssBlocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
    }
  }

  if (currentBlock.length > 0) {
    cssBlocks.push(currentBlock.join('\n'));
  }

  return {
    css: cssBlocks.join('\n'),
    cleanText: cleanTextLines.join('\n').trim()
  };
}

window.PORTAL_VERSION = '1.2.1';

function hslToHex(h, s, l) {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function App() {
  const [COMPANY_LIST, setCompanyList] = useState(['Laser', 'GMD', 'BHUVEE', 'CEEBUILD', 'COMMON', 'DAILMER', 'MAXCAB', 'UIC']);
  const COMPANY_COLORS = new Proxy({
    'Laser': '#6366f1', 'GMD': '#ec4899', 'BHUVEE': '#f59e0b',
    'CEEBUILD': '#10b981', 'COMMON': '#8b5cf6', 'DAILMER': '#ef4444',
    'MAXCAB': '#06b6d4', 'OUTSIDER': '#6b7280'
  }, {
    get: (target, name) => {
      if (typeof name !== 'string') return target[name];
      for (const k of Object.keys(target)) {
        if (k.toUpperCase() === name.toUpperCase()) return target[k];
      }
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
      }
      const h = Math.abs(hash) % 360;
      return hslToHex(h, 65, 45);
    }
  });

  const CATEGORY_COLORS = new Proxy({
    'Banking & Finance': '#10b981',
    'Legal': '#ef4444',
    'Sales': '#f59e0b',
    'Purchase': '#3b82f6',
    'HR Notification': '#8b5cf6',
    'Promotions': '#ec4899',
    'General': '#6b7280',
    'ADMIN': '#3b82f6',
    'AGENT/BROKER': '#6366f1',
    'CONSIGNEE': '#ec4899',
    'INTER COMPANY': '#8b5cf6',
    'INTERNAL': '#84cc16',
    'STAFF': '#d946ef',
    'TRANSPORTERS': '#f43f5e'
  }, {
    get: (target, name) => {
      if (typeof name !== 'string') return target[name];
      for (const k of Object.keys(target)) {
        if (k.toUpperCase() === name.toUpperCase()) return target[k];
      }
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
      }
      const h = Math.abs(hash) % 360;
      return hslToHex(h, 65, 45);
    }
  });

  const [theme, setThemeState] = useState(() => {
    try {
      return localStorage.getItem('siteTheme') || '';
    } catch (e) {
      return '';
    }
  });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [matchingRules, setMatchingRules] = useState([]);
  const [newRuleText, setNewRuleText] = useState('');

  // Sender Mapping states
  const [senderMappings, setSenderMappings] = useState([]);
  const [senderSearch, setSenderSearch] = useState('');
  const [newSenderName, setNewSenderName] = useState('');
  const [newSenderCompanies, setNewSenderCompanies] = useState([]);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadCompanies, setUploadCompanies] = useState([]);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [editMappingId, setEditMappingId] = useState(null);
  const [editMappingName, setEditMappingName] = useState('');
  const [editMappingCompanies, setEditMappingCompanies] = useState([]);
  const [senderLoading, setSenderLoading] = useState(false);
  const [activeCompanyFilter, setActiveCompanyFilter] = useState('');
  const [activeCwFilter, setActiveCwFilter] = useState(''); // codeword label filter
  const [dateSortOrder, setDateSortOrder] = useState('desc'); // 'asc' | 'desc'
  const [tenderDateSort, setTenderDateSort] = useState(''); // '' | 'asc' | 'desc'
  const [submissionDateSort, setSubmissionDateSort] = useState(''); // '' | 'asc' | 'desc'
  const [deadlineSort, setDeadlineSort] = useState(''); // '' | 'asc' | 'desc'
  // Tracks the order in which sort columns were last activated (most recent = primary)
  const [tenderSortPriority, setTenderSortPriority] = useState(['date', 'submission', 'deadline']);
  // Codeword states
  const [codewordsList, setCodewordsList] = useState([]);
  const [newCodeword, setNewCodeword] = useState('');
  const [newCwCompany, setNewCwCompany] = useState('');
  const [newCwCategory, setNewCwCategory] = useState('');
  const [newCwSubCategory, setNewCwSubCategory] = useState('');
  const [newCwDesc, setNewCwDesc] = useState('');
  const [editCodewordId, setEditCodewordId] = useState(null);
  const [editCodewordData, setEditCodewordData] = useState({});
  const [copyFeedbackIdx, setCopyFeedbackIdx] = useState(null);
  // Sender mapping category/sub_category
  const [newSenderCategory, setNewSenderCategory] = useState('');
  const [newSenderSubCategory, setNewSenderSubCategory] = useState('');
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploadSubCategory, setUploadSubCategory] = useState('');
  // Category/sub-category dropdown data sources
  const [availableCategories, setAvailableCategories] = useState([]);
  const [availableSubCategories, setAvailableSubCategories] = useState([]);
  const [editAvailableSubCategories, setEditAvailableSubCategories] = useState([]);
  const [cwAvailableSubCategories, setCwAvailableSubCategories] = useState([]);

  const fetchMatchingRules = async () => {
    try {
      const res = await fetch('/api/matching-rules');
      const data = await res.json();
      setMatchingRules(data);
    } catch (err) {
      console.error('Error fetching matching rules:', err);
    }
  };

  const handleAddRule = async (e) => {
    e.preventDefault();
    if (!newRuleText.trim()) return;
    try {
      const res = await fetch('/api/matching-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: newRuleText })
      });
      if (res.ok) {
        setNewRuleText('');
        fetchMatchingRules();
      }
    } catch (err) {
      console.error('Error adding rule:', err);
    }
  };

  const handleDeleteRule = async (id) => {
    try {
      const res = await fetch(`/api/matching-rules/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchMatchingRules();
      }
    } catch (err) {
      console.error('Error deleting rule:', err);
    }
  };

  // Sender Mapping API functions
  const fetchSenderMappings = async () => {
    try {
      const url = senderSearch ? `/api/sender-mappings?search=${encodeURIComponent(senderSearch)}` : '/api/sender-mappings';
      const res = await fetch(url);
      const data = await res.json();
      setSenderMappings(data);
    } catch (err) {
      console.error('Error fetching sender mappings:', err);
    }
  };

  const handleAddSenderMapping = async () => {
    if (!newSenderName.trim() || newSenderCompanies.length === 0) return;
    setSenderLoading(true);
    try {
      const res = await fetch('/api/sender-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_name: newSenderName.trim(),
          companies: newSenderCompanies,
          category: newSenderCategory.trim() || undefined,
          sub_category: newSenderSubCategory.trim() || undefined
        })
      });
      if (res.ok) {
        setNewSenderName('');
        setNewSenderCompanies([]);
        setNewSenderCategory('');
        setNewSenderSubCategory('');
        fetchSenderMappings();
      }
    } catch (err) {
      console.error('Error adding sender mapping:', err);
    } finally {
      setSenderLoading(false);
    }
  };

  const handleDeleteSenderMapping = async (id) => {
    try {
      const res = await fetch(`/api/sender-mappings/${id}`, { method: 'DELETE' });
      if (res.ok) fetchSenderMappings();
    } catch (err) {
      console.error('Error deleting sender mapping:', err);
    }
  };

  const handleUpdateSenderMapping = async () => {
    if (editMappingCompanies.length === 0) return;
    setSenderLoading(true);
    try {
      const res = await fetch(`/api/sender-mappings/${editMappingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companies: editMappingCompanies,
          category: newSenderCategory.trim() || undefined,
          sub_category: newSenderSubCategory.trim() || undefined
        })
      });
      if (res.ok) {
        setEditMappingId(null);
        setEditMappingName('');
        setEditMappingCompanies([]);
        setNewSenderCategory('');
        setNewSenderSubCategory('');
        fetchSenderMappings();
      }
    } catch (err) {
      console.error('Error updating sender mapping:', err);
    } finally {
      setSenderLoading(false);
    }
  };

  const handleExcelUpload = async () => {
    if (!uploadFile || uploadCompanies.length === 0) return;
    setSenderLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('companies', JSON.stringify(uploadCompanies));
      if (uploadCategory.trim()) formData.append('category', uploadCategory.trim());
      if (uploadSubCategory.trim()) formData.append('sub_category', uploadSubCategory.trim());
      const res = await fetch('/api/sender-mappings/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Upload complete!\nTotal: ${data.total}\nInserted: ${data.inserted}\nUpdated: ${data.updated}\nCompanies: ${data.companies.join(', ')}`);
        setUploadFile(null);
        setUploadPreview(null);
        setUploadCompanies([]);
        fetchSenderMappings();
      } else {
        alert(`Upload failed: ${data.error}`);
      }
    } catch (err) {
      console.error('Error uploading Excel:', err);
      alert('Upload failed. Check console.');
    } finally {
      setSenderLoading(false);
    }
  };

  // Codeword API functions
  const fetchCodewords = async () => {
    try {
      const res = await fetch('/api/codewords');
      const data = await res.json();
      setCodewordsList(data);
    } catch (err) {
      console.error('Error fetching codewords:', err);
    }
  };

  const handleAddCodeword = async () => {
    if (!newCodeword.trim() || !newCwCompany || !newCwCategory.trim()) return;
    try {
      const res = await fetch('/api/codewords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeword: newCodeword.trim(), company: newCwCompany, category: newCwCategory.trim(), sub_category: newCwSubCategory.trim() || '', description: newCwDesc.trim() || undefined })
      });
      if (res.ok) {
        setNewCodeword(''); setNewCwCompany(''); setNewCwCategory(''); setNewCwSubCategory(''); setNewCwDesc('');
        fetchCodewords();
      } else {
        const err = await res.json();
        alert(`Failed: ${err.error}`);
      }
    } catch (err) {
      console.error('Error adding codeword:', err);
    }
  };

  const handleDeleteCodeword = async (id) => {
    try {
      const res = await fetch(`/api/codewords/${id}`, { method: 'DELETE' });
      if (res.ok) fetchCodewords();
    } catch (err) {
      console.error('Error deleting codeword:', err);
    }
  };

  const handleUpdateCodeword = async () => {
    if (!editCodewordData.codeword || !editCodewordData.company || !editCodewordData.category) return;
    try {
      const res = await fetch(`/api/codewords/${editCodewordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editCodewordData)
      });
      if (res.ok) { setEditCodewordId(null); setEditCodewordData({}); fetchCodewords(); }
    } catch (err) {
      console.error('Error updating codeword:', err);
    }
  };

  // Fetch distinct categories/sub-categories from sender_company_mapping
  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/sender-categories');
      const data = await res.json();
      setAvailableCategories(data);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };
  const fetchCompanies = async () => {
    try {
      const res = await fetch('/api/sender-companies');
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          setCompanyList(data);
        }
      }
    } catch (err) {
      console.error('Error fetching companies:', err);
    }
  };
  const fetchSubCategories = async (category, setter) => {
    if (!category) { setter([]); return; }
    try {
      const res = await fetch(`/api/sender-subcategories?category=${encodeURIComponent(category)}`);
      const data = await res.json();
      setter(data);
    } catch (err) {
      console.error('Error fetching subcategories:', err);
    }
  };

  const autoGenerateCodeword = (company, category, subCategory) => {
    if (!company || !category) return '';
    const c = company.substring(0, 1).toUpperCase();
    const cat = category.replace(/[^A-Za-z0-9]/g, '').substring(0, 4).toUpperCase();
    if (!subCategory) return `${c}-${cat}`;
    const sub = subCategory.replace(/[^A-Za-z0-9]/g, '').substring(0, 4).toUpperCase();
    return `${c}-${cat}-${sub}`;
  };

  const handleFilePreview = (file) => {
    setUploadFile(file);
    if (!file) { setUploadPreview(null); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        const total = Math.max(0, lines.length - 1);
        const sample = lines.slice(1, Math.min(lines.length, 11)).map(l => l.split(',')[0].replace(/["']/g, '').trim()).filter(Boolean);
        setUploadPreview({ total, sample, fileName: file.name });
      } catch (err) {
        setUploadPreview({ total: 0, sample: [], fileName: file.name });
      }
    };
    reader.readAsText(file);
  };

  const loadLocalCache = (key, fallback) => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : fallback;
    } catch (e) {
      return fallback;
    }
  };

  const saveLocalCache = (key, data) => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {}
  };

  const [tenders, setTenders] = useState(() => loadLocalCache('portal_cached_tenders', []));
  const [selectedTender, setSelectedTender] = useState(null);
  const [tenderEmails, setTenderEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);

  const [status, setStatus] = useState(() => loadLocalCache('portal_cached_status', {
    sheetsAuth: false,
    database: false,
    dbFallbackActive: false,
    openaiKey: false,
    errors: {}
  }));

  const [syncInfo, setSyncInfo] = useState({
    synced: false,
    lastSynced: null,
    tendersCount: 0,
    participatedCount: 0,
    matchesCount: 0
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [filterParticipated, setFilterParticipated] = useState(false);
  const [filterMatchedOnly, setFilterMatchedOnly] = useState(true);
  const [filterUrgentReplyOnly, setFilterUrgentReplyOnly] = useState(false);
  const [recentMatches, setRecentMatches] = useState(() => loadLocalCache('portal_cached_recent_matches', []));
  const [matchedEmailsTotal, setMatchedEmailsTotal] = useState(0);
  const [subStartDate, setSubStartDate] = useState('');
  const [subEndDate, setSubEndDate] = useState('');
  const [recStartDate, setRecStartDate] = useState('');
  const [recEndDate, setRecEndDate] = useState('');
  const [showOnlyParticipatedIds, setShowOnlyParticipatedIds] = useState(false);

  const [remapping, setRemapping] = useState(false);
  const [remapResult, setRemapResult] = useState(null);

  // Chat & Feedback state
  const [showFullCc, setShowFullCc] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [reVerifyLoading, setReVerifyLoading] = useState(false);
  const [reVerifyResult, setReVerifyResult] = useState(null);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedbackWasCorrect, setFeedbackWasCorrect] = useState(null);
  const [feedbackRule, setFeedbackRule] = useState('');

  const handleRemapEmails = async () => {
    setRemapping(true);
    setRemapResult(null);
    try {
      const res = await fetch('/api/matching-rules/re-verify', {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setRemapResult(data);
        fetchTenders();
        fetchRecentMatches();
        fetchSyncInfo();
      } else {
        const err = await res.json();
        alert(`Remapping failed: ${err.error || 'Server error'}`);
      }
    } catch (err) {
      console.error('Remap error:', err);
      alert('Remapping failed. Please check backend connection.');
    } finally {
      setRemapping(false);
    }
  };

  // Chat & Feedback handlers
  const fetchChat = async (matchId) => {
    if (!matchId) return;
    try {
      const res = await fetch(`/api/matches/${matchId}/chat`);
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data);
      }
    } catch (err) {
      console.error('Error fetching chat:', err);
    }
  };

  const sendChat = async (matchId, message, sender = 'user') => {
    const targetId = matchId || (selectedEmail && (selectedEmail.match_id || selectedEmail.id));
    if (!targetId || !message.trim()) return;
    
    const currentMsg = message.trim();
    setChatInput('');
    setChatLoading(true);

    // Optimistically show user message immediately
    const tempUserMsg = {
      id: Date.now(),
      sender: 'user',
      message: currentMsg,
      created_at: new Date().toISOString()
    };
    setChatMessages(prev => [...prev, tempUserMsg]);

    try {
      const res = await fetch(`/api/matches/${targetId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender, message: currentMsg })
      });
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data);
      }
    } catch (err) {
      console.error('Error sending chat:', err);
    } finally {
      setChatLoading(false);
    }
  };

  const handleFeedback = async (matchId, wasCorrect) => {
    if (!matchId) return;
    setFeedbackLoading(true);
    setShowFeedbackForm(false);
    setFeedbackWasCorrect(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wasCorrect, userRule: feedbackRule })
      });
      if (res.ok) {
        setFeedbackRule('');
        await fetchChat(matchId);
      }
    } catch (err) {
      console.error('Error submitting feedback:', err);
    } finally {
      setFeedbackLoading(false);
    }
  };

  const handleReVerify = async (matchId) => {
    if (!matchId) return;
    setReVerifyLoading(true);
    setReVerifyResult(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/re-verify`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setReVerifyResult(data);
        await fetchChat(matchId);
        // Refresh tenders and matched emails
        fetchTenders();
        fetchRecentMatches();
        fetchSyncInfo();
      }
    } catch (err) {
      console.error('Error re-verifying match:', err);
    } finally {
      setReVerifyLoading(false);
    }
  };

  const openMatchChat = async (email) => {
    setSelectedEmail(email);
    setChatMessages([]);
    setChatInput('');
    setReVerifyResult(null);
    setShowFeedbackForm(false);
    setFeedbackWasCorrect(null);
    setFeedbackRule('');

    // Fetch full details of the email in the background to avoid loading huge payloads in the list query!
    (async () => {
      try {
        const res = await fetch(`/api/emails/${email.id}`);
        if (res.ok) {
          const fullData = await res.json();
          setSelectedEmail(prev => prev && prev.id === email.id ? { ...prev, ...fullData } : prev);
        }
      } catch (err) {
        console.error('Failed to load full email details:', err);
      }
    })();

    const chatTargetId = email.match_id || email.id;
    if (chatTargetId) {
      await fetchChat(chatTargetId);
    }
  };

  const [subFilterMode, setSubFilterMode] = useState('range'); // 'range' | 'interval'
  const [recFilterMode, setRecFilterMode] = useState('range'); // 'range' | 'interval'

  // Interval filter states (month-wise, day-wise)
  const [subIntervalValue, setSubIntervalValue] = useState('');
  const [subIntervalUnit, setSubIntervalUnit] = useState('days'); // 'days' | 'months'
  const [subIntervalDir, setSubIntervalDir] = useState('next'); // 'last' | 'next'
  
  const [recIntervalValue, setRecIntervalValue] = useState('');
  const [recIntervalUnit, setRecIntervalUnit] = useState('days'); // 'days' | 'months'
  const [recIntervalDir, setRecIntervalDir] = useState('last'); // 'last' | 'next'

  // Helper to convert date to local YYYY-MM-DD string in Asia/Kolkata timezone
  const getLocalDateString = (date) => {
    if (!date || isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date);
    } catch (e) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  };

  // Helper to compute start/end dates from interval
  const getIntervalDateRange = (value, unit, dir) => {
    if (!value || isNaN(value) || value <= 0) return { start: '', end: '' };
    const num = parseFloat(value);
    const now = new Date();
    let target = new Date();
    
    if (unit === 'days') {
      if (dir === 'last') {
        target.setDate(now.getDate() - num);
        return { start: getLocalDateString(target), end: getLocalDateString(now) };
      } else {
        target.setDate(now.getDate() + num);
        return { start: getLocalDateString(now), end: getLocalDateString(target) };
      }
    } else if (unit === 'months') {
      if (dir === 'last') {
        target.setMonth(now.getMonth() - num);
        return { start: getLocalDateString(target), end: getLocalDateString(now) };
      } else {
        target.setMonth(now.getMonth() + num);
        return { start: getLocalDateString(now), end: getLocalDateString(target) };
      }
    }
    return { start: '', end: '' };
  };

  // Sync Submission Date interval with date pickers
  useEffect(() => {
    if (subFilterMode === 'interval') {
      if (subIntervalValue && !isNaN(subIntervalValue) && parseFloat(subIntervalValue) > 0) {
        const { start, end } = getIntervalDateRange(subIntervalValue, subIntervalUnit, subIntervalDir);
        setSubStartDate(start);
        setSubEndDate(end);
      } else {
        setSubStartDate('');
        setSubEndDate('');
      }
    }
  }, [subFilterMode, subIntervalValue, subIntervalUnit, subIntervalDir]);

  // Sync Email Received interval with date pickers
  useEffect(() => {
    if (recFilterMode === 'interval') {
      if (recIntervalValue && !isNaN(recIntervalValue) && parseFloat(recIntervalValue) > 0) {
        const { start, end } = getIntervalDateRange(recIntervalValue, recIntervalUnit, recIntervalDir);
        setRecStartDate(start);
        setRecEndDate(end);
      } else {
        setRecStartDate('');
        setRecEndDate('');
      }
    }
  }, [recFilterMode, recIntervalValue, recIntervalUnit, recIntervalDir]);

  const handleClearSubFilter = () => {
    setSubStartDate('');
    setSubEndDate('');
    setSubIntervalValue('');
  };

  const handleClearRecFilter = () => {
    setRecStartDate('');
    setRecEndDate('');
    setRecIntervalValue('');
  };

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);

  const [emailsList, setEmailsList] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [modalStartDate, setModalStartDate] = useState('');
  const [modalEndDate, setModalEndDate] = useState('');
  const [excludeTenderTiger, setExcludeTenderTiger] = useState(false);
  const [matchedEmailsPage, setMatchedEmailsPage] = useState(1);
  const [matchedEmailsLimit] = useState(50);
  const [replyTender, setReplyTender] = useState(null);
  const [replyEmails, setReplyEmails] = useState([]);
  const [selectedReplyEmailId, setSelectedReplyEmailId] = useState('');
  const [replyDraft, setReplyDraft] = useState({ to: '', subject: '', body: '', attachments: [] });
  const [selectedAttachmentIndices, setSelectedAttachmentIndices] = useState([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);

  // All Emails Explorer States
  const [allEmails, setAllEmails] = useState([]);
  const [allEmailsTotal, setAllEmailsTotal] = useState(0);
  const [allEmailsPage, setAllEmailsPage] = useState(1);
  const [allEmailsLimit, setAllEmailsLimit] = useState(20);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');
  const [selectedSubCategoryFilter, setSelectedSubCategoryFilter] = useState('');
  const [explorerSubCategories, setExplorerSubCategories] = useState([]);

  useEffect(() => {
    setSelectedSubCategoryFilter('');
    if (selectedCategoryFilter) {
      fetchSubCategories(selectedCategoryFilter, setExplorerSubCategories);
    } else {
      setExplorerSubCategories([]);
    }
  }, [selectedCategoryFilter]);
  const [selectedLabelFilter, setSelectedLabelFilter] = useState('');
  const [allEmailsSearch, setAllEmailsSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(allEmailsSearch), 300);
    return () => clearTimeout(timer);
  }, [allEmailsSearch]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [debouncedRecipient, setDebouncedRecipient] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedRecipient(recipientSearch), 300);
    return () => clearTimeout(timer);
  }, [recipientSearch]);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [allEmailsLoading, setAllEmailsLoading] = useState(false);
  const [availableLabels, setAvailableLabels] = useState([]);
  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [labelTargetEmail, setLabelTargetEmail] = useState(null);
  const [labelInput, setLabelInput] = useState('');
  const [emailDetailModalOpen, setEmailDetailModalOpen] = useState(false);
  const [detailedEmail, setDetailedEmail] = useState(null);
  const [detailedEmailLoading, setDetailedEmailLoading] = useState(false);
  const [emailViewMode, setEmailViewMode] = useState('threaded');
  const [expandedThreadMessages, setExpandedThreadMessages] = useState({ 0: true });

  // deadline extraction runs automatically on backend during sync; no manual button needed

  // AbortController refs to prevent stale responses from overwriting newer ones
  const fetchAllEmailsAbortRef = useRef(null);
  const fetchMatchedEmailsAbortRef = useRef(null);
  const fetchTendersAbortRef = useRef(null);
  const fetchRecentMatchesAbortRef = useRef(null);
  const fetchTenderEmailsAbortRef = useRef(null);
  const fetchEmailDetailAbortRef = useRef(null);

  // All Emails Explorer Fetch & Manage Functions
  const fetchAllEmails = async (sortOrderOverride) => {
    if (fetchAllEmailsAbortRef.current) fetchAllEmailsAbortRef.current.abort();
    const controller = new AbortController();
    fetchAllEmailsAbortRef.current = controller;
    setAllEmailsLoading(true);
    const effectiveSortOrder = sortOrderOverride || dateSortOrder;
    try {
      let url = `/api/all-emails?page=${allEmailsPage}&limit=${allEmailsLimit}&excludeTenderTiger=${excludeTenderTiger}&sortOrder=${effectiveSortOrder}`;
      if (selectedCategoryFilter) url += `&category=${encodeURIComponent(selectedCategoryFilter)}`;
      if (selectedSubCategoryFilter) url += `&subCategory=${encodeURIComponent(selectedSubCategoryFilter)}`;
      if (selectedLabelFilter) url += `&label=${encodeURIComponent(selectedLabelFilter)}`;
      if (debouncedSearch) url += `&search=${encodeURIComponent(debouncedSearch)}`;
      if (debouncedRecipient) url += `&recipient=${encodeURIComponent(debouncedRecipient)}`;
      if (recStartDate) url += `&startDate=${recStartDate}`;
      if (recEndDate) url += `&endDate=${recEndDate}`;
      if (urgentOnly) url += `&urgentOnly=true`;
      if (activeCompanyFilter) url += `&company=${encodeURIComponent(activeCompanyFilter)}`;
      if (activeCwFilter) url += `&codeword=${encodeURIComponent(activeCwFilter)}`;

      const res = await fetch(url, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAllEmails(data.emails || []);
          setAllEmailsTotal(data.total || 0);
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch all emails:', err);
    } finally {
      setAllEmailsLoading(false);
    }
  };

  const fetchAvailableLabels = async () => {
    try {
      const res = await fetch('/api/labels');
      if (res.ok) {
        const labels = await res.json();
        const defaultLabels = ['freight forwarding', 'Other', 'Urgent', 'Review', 'sales related', 'Request', 'Important'];
        // Merge default labels with database labels to ensure they are always present in the toggles
        const merged = Array.from(new Set([
          ...defaultLabels,
          ...(labels || [])
        ]));
        setAvailableLabels(merged.sort());
      }
    } catch (err) {
      console.error('Failed to fetch available labels:', err);
    }
  };

  const handleOpenEmailDetail = async (emailId) => {
    if (fetchEmailDetailAbortRef.current) fetchEmailDetailAbortRef.current.abort();
    const controller = new AbortController();
    fetchEmailDetailAbortRef.current = controller;
    setEmailDetailModalOpen(true);
    setDetailedEmailLoading(true);
    setDetailedEmail(null);
    setEmailViewMode('threaded');
    setExpandedThreadMessages({ 0: true });
    try {
      const res = await fetch(`/api/emails/${emailId}`, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        setDetailedEmail(data);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch email details:', err);
    } finally {
      setDetailedEmailLoading(false);
    }
  };

  const handleUpdateLabels = async (emailId, newLabelsArray) => {
    try {
      const res = await fetch(`/api/emails/${emailId}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels: newLabelsArray })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const updatedLabelStr = data.labels || '';
          
          // Update in local lists
          setAllEmails(prev => prev.map(e => e.id === emailId ? { ...e, user_labels: updatedLabelStr } : e));
          
          if (detailedEmail && detailedEmail.id === emailId) {
            setDetailedEmail(prev => prev ? { ...prev, user_labels: updatedLabelStr } : null);
          }
          
          if (selectedEmail && selectedEmail.id === emailId) {
            setSelectedEmail(prev => prev ? { ...prev, user_labels: updatedLabelStr } : null);
          }
          
          // Refresh labels list
          fetchAvailableLabels();

          // Show AI Smart-Label Propagation notification
          if (data.propagatedCount && data.propagatedCount > 0) {
            const subjectsList = data.propagatedEmails.map(e => `• ${e.subject}`).slice(0, 10).join('\n');
            const limitMsg = data.propagatedEmails.length > 10 ? `\n...and ${data.propagatedEmails.length - 10} more.` : '';
            alert(`AI Smart-Label Propagation Success!\n\n` +
                  `The AI successfully identified and auto-labeled ${data.propagatedCount} other related emails in your database:\n\n` +
                  `${subjectsList}${limitMsg}`);
          }
        }
      }
    } catch (err) {
      console.error('Failed to update labels:', err);
    }
  };

  const handleRemoveLabel = (email, labelToRemove) => {
    if (!email.user_labels) return;
    const currentList = email.user_labels.split(',').map(l => l.trim()).filter(l => l !== '');
    const newList = currentList.filter(l => l.toLowerCase() !== labelToRemove.toLowerCase());
    handleUpdateLabels(email.id, newList);
  };

  const handleAddLabel = (email, labelToAdd) => {
    const cleanLabel = labelToAdd.trim();
    if (!cleanLabel) return;
    const currentList = email.user_labels ? email.user_labels.split(',').map(l => l.trim()).filter(l => l !== '') : [];
    if (currentList.some(l => l.toLowerCase() === cleanLabel.toLowerCase())) return;
    const newList = [...currentList, cleanLabel];
    handleUpdateLabels(email.id, newList);
  };

  // Ref to track previous filter values for detecting changes vs pagination
  const prevAllEmailFiltersRef = useRef({ category: '', subCategory: '', label: '', search: '', recipient: '', startDate: '', endDate: '', urgentOnly: false, excludeTenderTiger: false, sortOrder: 'desc', company: '', codeword: '' });

  // Fetch all emails when tab, pagination, category, label, search, or global date filters change
  useEffect(() => {
    if (activeTab !== 'all-emails') return;
    const prev = prevAllEmailFiltersRef.current;
    const curr = { category: selectedCategoryFilter, subCategory: selectedSubCategoryFilter, label: selectedLabelFilter, search: debouncedSearch, recipient: debouncedRecipient, startDate: recStartDate, endDate: recEndDate, urgentOnly, excludeTenderTiger, sortOrder: dateSortOrder, company: activeCompanyFilter, codeword: activeCwFilter };
    const filtersChanged = prev.category !== curr.category || prev.subCategory !== curr.subCategory || prev.label !== curr.label || prev.search !== curr.search || prev.recipient !== curr.recipient || prev.startDate !== curr.startDate || prev.endDate !== curr.endDate || prev.urgentOnly !== curr.urgentOnly || prev.excludeTenderTiger !== curr.excludeTenderTiger || prev.sortOrder !== curr.sortOrder || prev.company !== curr.company || prev.codeword !== curr.codeword;
    if (filtersChanged && allEmailsPage !== 1) {
      setAllEmailsPage(1);
      prevAllEmailFiltersRef.current = curr;
      return;
    }
    prevAllEmailFiltersRef.current = curr;
    fetchAllEmails(dateSortOrder);
  }, [activeTab, allEmailsPage, allEmailsLimit, selectedCategoryFilter, selectedSubCategoryFilter, selectedLabelFilter, debouncedSearch, debouncedRecipient, recStartDate, recEndDate, excludeTenderTiger, urgentOnly, activeCompanyFilter, activeCwFilter, dateSortOrder]);

  // Fetch available labels and categories when tab changes to all-emails
  useEffect(() => {
    if (activeTab === 'all-emails') {
      fetchAvailableLabels();
      fetchCategories();
    }
  }, [activeTab]);

  // Fetch company data on load and whenever the active tab changes so the filter stays updated.
  useEffect(() => {
    fetchCompanies();
    if (activeTab === 'sender-mapping') {
      fetchSenderMappings();
      fetchCodewords();
      fetchCategories();
    }
  }, [activeTab, senderSearch]);

  const loadReplySuggestion = async (emailId) => {
    setDraftLoading(true);
    setSelectedAttachmentIndices([]);
    try {
      const res = await fetch(`/api/emails/${emailId}/reply-suggestion`);
      const data = await res.json();
      if (res.ok && data.success) {
        setReplyDraft({
          to: data.to,
          subject: data.subject,
          body: data.suggestedReply,
          attachments: data.attachments || []
        });
      } else {
        alert(`Failed to load reply suggestion: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Failed to fetch reply suggestion:', err);
      alert('Error fetching reply suggestion.');
    } finally {
      setDraftLoading(false);
    }
  };

  const handleOpenReplyModal = async (tender) => {
    setReplyTender(tender);
    setReplyEmails([]);
    setSelectedReplyEmailId('');
    setReplyDraft({ to: '', subject: '', body: '', attachments: [] });
    setSelectedAttachmentIndices([]);
    setDraftLoading(true);

    try {
      const res = await fetch(`/api/tenders/${tender.rowNumber}/emails?excludeTenderTiger=${excludeTenderTiger}&docket_no=${encodeURIComponent(tender.docketNo || '')}&tender_no=${encodeURIComponent(tender.tenderNoRaw || '')}`);
      const emails = await res.json();
      setReplyEmails(emails);

      if (emails.length > 0) {
        const latestEmail = emails.find(email => String(email.id) === String(tender.latestEmailId)) || emails[0];
        setSelectedReplyEmailId(latestEmail.id);
        await loadReplySuggestion(latestEmail.id);
      } else {
        setDraftLoading(false);
        alert('No matched emails found to reply to.');
      }
    } catch (err) {
      console.error('Failed to initialize reply modal:', err);
      setDraftLoading(false);
      alert('Error loading emails for tender.');
    }
  };

  const handleSelectReplyEmail = async (emailId) => {
    setSelectedReplyEmailId(emailId);
    await loadReplySuggestion(emailId);
  };

  const [quickReplyLoading, setQuickReplyLoading] = useState({});

  const handleQuickAutoReply = async (tender) => {
    if (!tender.latestEmailId) {
      alert('No matched email ID found for this tender.');
      return;
    }
    
    const confirmSend = window.confirm(
      `Are you sure you want to automatically generate and send an AI reply to the recipient for Tender: ${tender.tenderFor || 'Tender'}?`
    );
    if (!confirmSend) return;

    setQuickReplyLoading(prev => ({ ...prev, [tender.rowNumber]: true }));
    try {
      // Step 1: Fetch AI suggested reply
      const suggestionRes = await fetch(`/api/emails/${tender.latestEmailId}/reply-suggestion`);
      const suggestionData = await suggestionRes.json();
      
      if (!suggestionRes.ok || !suggestionData.success) {
        throw new Error(suggestionData.error || 'Failed to generate suggested reply');
      }

      const { to, subject, suggestedReply, attachments } = suggestionData;
      if (!to || !subject || !suggestedReply) {
        throw new Error('Suggested reply did not contain all required fields.');
      }

      // Step 2: Send the email via the backend send API
      const sendRes = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject,
          body: suggestedReply,
          attachments: attachments || []
        })
      });
      
      const sendData = await sendRes.json();
      if (sendRes.ok && (sendData.success || sendData.messageId)) {
        alert(`Successfully generated and sent AI auto-reply to: ${to}`);
        // Refresh tenders to update status since reply has been sent
        fetchTenders();
      } else {
        throw new Error(sendData.error || 'Failed to send email');
      }
    } catch (err) {
      console.error('AI Auto-Reply failed:', err);
      alert(`AI Auto-Reply failed: ${err.message}`);
    } finally {
      setQuickReplyLoading(prev => ({ ...prev, [tender.rowNumber]: false }));
    }
  };

  const handleOpenEmailReplyModal = async (email) => {
    const mockTender = {
      rowNumber: -1,
      docketNo: email.docket_no || 'N/A',
      tenderNoRaw: email.tender_no || 'N/A',
      latestEmailId: email.id,
      tenderFor: email.subject
    };
    setReplyTender(mockTender);
    setReplyEmails([email]);
    setSelectedReplyEmailId(email.id);
    setReplyDraft({ to: '', subject: '', body: '', attachments: [] });
    setSelectedAttachmentIndices([]);
    setDraftLoading(true);

    try {
      await loadReplySuggestion(email.id);
    } catch (err) {
      console.error('Failed to load reply suggestion:', err);
      setDraftLoading(false);
    }
  };

  const handleQuickAutoReplyForEmail = async (email) => {
    const confirmSend = window.confirm(
      `Are you sure you want to automatically generate and send an AI reply to the recipient: ${email.sender}?`
    );
    if (!confirmSend) return;

    setQuickReplyLoading(prev => ({ ...prev, [email.id]: true }));
    try {
      // Step 1: Fetch reply suggestion
      const suggestionRes = await fetch(`/api/emails/${email.id}/reply-suggestion`);
      const suggestionData = await suggestionRes.json();
      if (!suggestionRes.ok || !suggestionData.success) {
        throw new Error(suggestionData.error || 'Failed to fetch reply suggestion');
      }

      const { to, subject, suggestedReply, attachments } = suggestionData;
      if (!to || !subject || !suggestedReply) {
        throw new Error('Suggested reply did not contain all required fields.');
      }

      // Step 2: Send the email via the backend send API
      const sendRes = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject,
          body: suggestedReply,
          attachments: attachments || []
        })
      });
      
      const sendData = await sendRes.json();
      if (sendRes.ok && (sendData.success || sendData.messageId)) {
        alert(`Successfully generated and sent AI auto-reply to: ${to}`);
        // Refresh all emails in the explorer to reflect any updates
        fetchAllEmails();
      } else {
        throw new Error(sendData.error || 'Failed to send email');
      }
    } catch (err) {
      console.error('AI Auto-Reply failed:', err);
      alert(`AI Auto-Reply failed: ${err.message}`);
    } finally {
      setQuickReplyLoading(prev => ({ ...prev, [email.id]: false }));
    }
  };

  const handleSendEmail = async () => {
    if (!replyDraft.to || !replyDraft.subject || !replyDraft.body) {
      alert('Recipient, subject, and body are required.');
      return;
    }
    setSendLoading(true);
    try {
      const selectedAtts = selectedAttachmentIndices.map(idx => replyDraft.attachments[idx]);
      const res = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: replyDraft.to,
          subject: replyDraft.subject,
          body: replyDraft.body,
          attachments: selectedAtts
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Email Sent Successfully!\nMode: ${data.mode}\nMessage ID: ${data.messageId}`);
        setReplyTender(null);
      } else {
        alert(`Failed to send email: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Send email error:', err);
      alert('Network error sending email.');
    } finally {
      setSendLoading(false);
    }
  };

  const fetchMatchedEmails = async (start = '', end = '', page = 1) => {
    if (fetchMatchedEmailsAbortRef.current) fetchMatchedEmailsAbortRef.current.abort();
    const controller = new AbortController();
    fetchMatchedEmailsAbortRef.current = controller;
    setEmailsLoading(true);
    try {
      const baseUrl = showOnlyParticipatedIds ? '/api/matched-participated-emails' : '/api/matched-emails';
      let url = `${baseUrl}?excludeTenderTiger=${excludeTenderTiger}&page=${page}&limit=${matchedEmailsLimit}`;
      if (start) url += `&startDate=${start}`;
      if (end) url += `&endDate=${end}`;
      if (activeCompanyFilter) url += `&company=${encodeURIComponent(activeCompanyFilter)}`;
      if (activeCwFilter) url += `&codeword=${encodeURIComponent(activeCwFilter)}`;
      const res = await fetch(url, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        const emails = Array.isArray(data) ? data : (data.emails || []);
        setEmailsList(emails);
        if (!Array.isArray(data) && data.total !== undefined) {
          setMatchedEmailsTotal(data.total);
        }
      } else {
        setEmailsList([]);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch matched emails:', err);
      setEmailsList([]);
    } finally {
      setEmailsLoading(false);
    }
  };

  // Reset page when company or codeword filters change
  useEffect(() => {
    setMatchedEmailsPage(1);
  }, [activeCompanyFilter, activeCwFilter]);

  // Fetch matched emails when the Matched Emails or Dashboard tab is active
  useEffect(() => {
    if (activeTab !== 'emails' && activeTab !== 'dashboard') return;
    fetchMatchedEmails(recStartDate, recEndDate, matchedEmailsPage);
  }, [activeTab, recStartDate, recEndDate, excludeTenderTiger, matchedEmailsPage, showOnlyParticipatedIds, activeCompanyFilter, activeCwFilter]);

  // Refetch data when the TenderTiger domain filter changes
  useEffect(() => {
    fetchSyncInfo();
    fetchTenders();
    fetchRecentMatches();
    if (selectedTender) {
      loadTenderEmails(selectedTender);
    }
  }, [excludeTenderTiger]);

  // Fetch initial configuration status and sync info
  useEffect(() => {
    fetchStatus();
    fetchSyncInfo();
    fetchTenders();
    fetchRecentMatches();
    fetchMatchingRules();
  }, []);

  // Poll for background match updates and sync status every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSyncInfo();
      fetchRecentMatches();
      fetchTenders({ showLoading: false });
    }, 300000);
    return () => clearInterval(interval);
  }, [excludeTenderTiger]);

  const fetchRecentMatches = async () => {
    if (fetchRecentMatchesAbortRef.current) fetchRecentMatchesAbortRef.current.abort();
    const controller = new AbortController();
    fetchRecentMatchesAbortRef.current = controller;
    try {
      const res = await fetch(`/api/recent-matches?excludeTenderTiger=${excludeTenderTiger}&limit=20`, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        // Handle both old (array) and new (paginated object) response formats
        const emails = Array.isArray(data) ? data : (data.emails || []);
        setRecentMatches(emails);
        saveLocalCache('portal_cached_recent_matches', emails);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch recent matches:', err);
    }
  };


  const parseGSheetDate = (dateStr) => {
    if (!dateStr) return null;
    const clean = String(dateStr).trim();
    if (clean === 'N/A' || clean === '' || clean === '-') return null;

    const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

    // Format 0: Named Month Slash format e.g., "Sep/19/2023 4:00:06", "Sep/19/2023"
    let m = clean.match(/^([a-z]{3,9})\/(\d{1,2})\/(\d{2,4})(?:\s+.*)?$/i);
    if (m) {
      let monthName = m[1].toLowerCase().substring(0, 3);
      let day = Number(m[2]);
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      if (months[monthName] !== undefined) {
        return new Date(year, months[monthName], day);
      }
    }

    // Format 1: Slash format (DD/MM/YYYY or DD/MM/YY) e.g., "28/08/2026", "28/8/26 15:00"
    m = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+.*)?$/);
    if (m) {
      let day = Number(m[1]);
      let month = Number(m[2]) - 1;
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      return new Date(year, month, day);
    }

    // Format 2: Dot format (DD.MM.YYYY or DD.MM.YY) e.g., "28.08.2026"
    m = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s+.*)?$/);
    if (m) {
      let day = Number(m[1]);
      let month = Number(m[2]) - 1;
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      return new Date(year, month, day);
    }

    // Format 3: Dash format (YYYY-MM-DD) e.g., "2026-08-28"
    m = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+.*)?$/);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }

    // Format 4: Dash format (DD-MM-YYYY or DD-MM-YY) e.g., "28-08-2026", "28-08-26"
    m = clean.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})(?:\s+.*)?$/);
    if (m) {
      let day = Number(m[1]);
      let month = Number(m[2]) - 1;
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      return new Date(year, month, day);
    }

    // Format 5: Named Month format (DD-MMM-YYYY or DD MMM YYYY) e.g., "28-Aug-2026", "05-Sep-2026"
    m = clean.match(/^(\d{1,2})[-\s]+([a-z]{3,9})[-\s]+(\d{2,4})(?:\s+.*)?$/i);
    if (m) {
      let day = Number(m[1]);
      let monthName = m[2].toLowerCase().substring(0, 3);
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      if (months[monthName] !== undefined) {
        return new Date(year, months[monthName], day);
      }
    }

    const d = new Date(clean);
    return isNaN(d.getTime()) ? null : d;
  };

  // Extract all HTTP/HTTPS links from body text, attachments, and html content
  const extractEmailLinks = (email) => {
    if (!email) return [];
    const textSources = [
      email.body || '',
      email.subject || '',
      email.attach_links || ''
    ];
    const combined = textSources.join(' ');

    const hrefMatches = Array.from(combined.matchAll(/href=["'](https?:\/\/[^"'>\s]+)["']/gi)).map(m => m[1]);
    const rawMatches = Array.from(combined.matchAll(/(https?:\/\/[^\s<"'>]+)/gi)).map(m => m[1]);

    const seen = new Set();
    const result = [];

    [...hrefMatches, ...rawMatches].forEach(link => {
      const clean = link.replace(/[\.,;\)]+$/, '').trim();
      if (clean && !seen.has(clean) && clean.length > 8) {
        seen.add(clean);
        let domain = 'external';
        try {
          domain = new URL(clean).hostname.replace(/^www\./, '');
        } catch (e) {
          domain = 'link';
        }

        // Exclude Google Drive and Google Docs links per user request
        const lowerUrl = clean.toLowerCase();
        const lowerDomain = domain.toLowerCase();
        if (
          lowerDomain.includes('drive.google') ||
          lowerDomain.includes('docs.google') ||
          lowerUrl.includes('drive.google.com') ||
          lowerUrl.includes('docs.google.com')
        ) {
          return;
        }

        result.push({ url: clean, domain });
      }
    });

    return result;
  };

  // Locate match position (Subject, Body, Attachments, OCR) and extract surrounding context snippet
  const getMatchSnippet = (email) => {
    if (!email) return null;
    const tokenStr = email.matchedToken || email.matched_token;
    if (!tokenStr) return null;

    const tokenList = String(tokenStr).split(',').map(t => t.trim()).filter(Boolean);
    if (tokenList.length === 0) return null;

    let location = '';
    let snippet = '';

    for (const tok of tokenList) {
      const lowerTok = tok.toLowerCase();
      // 1. Subject Check
      if (email.subject && email.subject.toLowerCase().includes(lowerTok)) {
        location = 'Subject Line';
        snippet = email.subject;
        break;
      }
      // 2. Attachment Filename Check
      if (email.attach_names && email.attach_names.toLowerCase().includes(lowerTok)) {
        location = 'Attachment File Name';
        const files = email.attach_names.split(',');
        const matchedFile = files.find(f => f.toLowerCase().includes(lowerTok)) || email.attach_names;
        snippet = `File: ${matchedFile.trim()}`;
        break;
      }
      // 3. Email Body Check
      if (email.body && email.body.toLowerCase().includes(lowerTok)) {
        location = 'Email Body Text';
        const idx = email.body.toLowerCase().indexOf(lowerTok);
        const start = Math.max(0, idx - 70);
        const end = Math.min(email.body.length, idx + lowerTok.length + 70);
        snippet = (start > 0 ? '...' : '') + email.body.substring(start, end).replace(/[\r\n]+/g, ' ') + (end < email.body.length ? '...' : '');
        break;
      }
      // 4. OCR Text Check
      const ocrText = email.ocr_text || email.ocr_snippet || '';
      if (ocrText && ocrText.toLowerCase().includes(lowerTok)) {
        location = 'Attached Document (PDF/Image OCR)';
        const idx = ocrText.toLowerCase().indexOf(lowerTok);
        const start = Math.max(0, idx - 70);
        const end = Math.min(ocrText.length, idx + lowerTok.length + 70);
        snippet = (start > 0 ? '...' : '') + ocrText.substring(start, end).replace(/[\r\n]+/g, ' ') + (end < ocrText.length ? '...' : '');
        break;
      }
    }

    if (!location) {
      location = email.confidence === 'HIGH' ? 'Subject / Attachment File Name' : 'Email Body / Attached PDF OCR';
      snippet = `Token "${tokenList[0]}" matched during candidate thread scan.`;
    }

    return { location, snippet, token: tokenList[0] };
  };

  const isSentinelDate = (dtStr) => {
    if (!dtStr) return true;
    const s = String(dtStr).trim();
    if (s.startsWith('1970-01-01') || s.startsWith('1969-12-31')) return true;
    try {
      const d = new Date(s);
      if (!isNaN(d.getTime()) && d.getFullYear() <= 1970) {
        return true;
      }
    } catch (e) {}
    return false;
  };

  const formatDateTime = (dtStr) => {
    if (!dtStr || isSentinelDate(dtStr)) return '-';
    try {
      let d;
      if (dtStr instanceof Date) {
        d = dtStr;
      } else {
        let s = String(dtStr).trim();
        const mysqlMatch = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
        if (mysqlMatch) {
          s = `${mysqlMatch[1]}T${mysqlMatch[2]}Z`;
        }
        d = new Date(s);
      }
      if (isNaN(d.getTime()) || d.getFullYear() <= 1970) return '-';

      return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch (e) {
      return String(dtStr);
    }
  };

  const mergeEmailLists = (...lists) => {
    const seen = new Set();
    const out = [];
    lists.forEach(list => {
      if (!list || list === '[None]') return;
      String(list).split(',').forEach(addr => {
        const t = addr.trim();
        if (t && !seen.has(t.toLowerCase())) {
          seen.add(t.toLowerCase());
          out.push(t);
        }
      });
    });
    return out.join(', ');
  };

  const formatDateOnly = (dtStr) => {
    if (!dtStr || isSentinelDate(dtStr)) return '-';
    let s = String(dtStr).trim();
    try {
      const mysqlMatch = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
      if (mysqlMatch) {
        s = `${mysqlMatch[1]}T${mysqlMatch[2]}`;
      }
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      const isoDate = new Date(s.split(' ')[0]);
      return !isNaN(isoDate.getTime()) ? isoDate.toISOString().slice(0, 10) : dtStr;
    } catch (e) {
      return dtStr;
    }
  };

  const isDeadlinePastOrToday = (dtStr) => {
    if (!dtStr || isSentinelDate(dtStr)) return false;
    let s = String(dtStr).trim();
    try {
      const mysqlMatch = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
      if (mysqlMatch) {
        s = `${mysqlMatch[1]}T${mysqlMatch[2]}`;
      }
      const deadline = new Date(s);
      if (isNaN(deadline.getTime())) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      deadline.setHours(0, 0, 0, 0);
      return deadline <= today;
    } catch (e) {
      return false;
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  const fetchSyncInfo = async () => {
    try {
      const res = await fetch(`/api/sync-info?excludeTenderTiger=${excludeTenderTiger}`);
      const data = await res.json();
      setSyncInfo(data);
    } catch (err) {
      console.error('Failed to fetch sync info:', err);
    }
  };

  // Apply theme by toggling classes on body and persisting choice
  const applyTheme = (newTheme) => {
    try {
      const body = document.body;
      body.classList.remove('theme-dark', 'theme-pink');
      if (newTheme === 'dark') {
        body.classList.add('theme-dark');
      } else if (newTheme === 'pink') {
        body.classList.add('theme-pink');
      }
      setThemeState(newTheme);
      localStorage.setItem('siteTheme', newTheme);
    } catch (e) {
      console.error('Failed to apply theme', e);
    }
  };

  // Initialize theme on mount
  useEffect(() => {
    if (theme) {
      const body = document.body;
      body.classList.remove('theme-dark', 'theme-pink');
      if (theme === 'dark') body.classList.add('theme-dark');
      if (theme === 'pink') body.classList.add('theme-pink');
    }
  }, []); // run once

  const fetchTenders = async ({ showLoading = true } = {}) => {
    if (fetchTendersAbortRef.current) fetchTendersAbortRef.current.abort();
    const controller = new AbortController();
    fetchTendersAbortRef.current = controller;
    if (showLoading) setLoading(true);
    try {
      const res = await fetch(`/api/tenders?excludeTenderTiger=${excludeTenderTiger}`, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        setTenders(data);
        saveLocalCache('portal_cached_tenders', data);
      } else {
        setTenders([]);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch tenders:', err);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // No manual deadline handler: backend sets deadlines automatically during sync

  const triggerSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync?forceFullSync=true');
      const data = await res.json();
      if (res.ok) {
        alert(`Sync Complete!\nSynced ${data.totalTenders} tenders.\nMatched ${data.matchedEmailsCount} emails.`);
        fetchSyncInfo();
        fetchTenders();
        fetchStatus();
        fetchRecentMatches();
        fetchMatchedEmails(recStartDate, recEndDate);
      } else {
        alert(`Sync Failed: ${data.error}\n${data.details || ''}`);
      }
    } catch (err) {
      console.error('Sync failed:', err);
      alert('Network error during sync.');
    } finally {
      setSyncing(false);
    }
  };

  const loadTenderEmails = async (tender) => {
    if (fetchTenderEmailsAbortRef.current) fetchTenderEmailsAbortRef.current.abort();
    const controller = new AbortController();
    fetchTenderEmailsAbortRef.current = controller;
    setSelectedTender(tender);
    setTenderEmails([]); // Clear state immediately to prevent showing stale emails from other tenders!
    setModalStartDate('');
    setModalEndDate('');
    setEmailLoading(true);
    try {
      let url = `/api/tenders/${tender.rowNumber}/emails?excludeTenderTiger=${excludeTenderTiger}&preview=true&docket_no=${encodeURIComponent(tender.docketNo || '')}&tender_no=${encodeURIComponent(tender.tenderNoRaw || '')}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setTenderEmails(data);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Failed to fetch emails for tender:', err);
      setTenderEmails([]);
    } finally {
      setEmailLoading(false);
    }
  };

  const handleManualSummarize = async (emailId) => {
    setSummarizing(true);
    try {
      const res = await fetch(`/api/emails/${emailId}/summarize`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok) {
        // Update local views
        setSelectedEmail(prev => prev ? { ...prev, summary: data.summary } : null);
        setTenderEmails(prev => prev.map(e => e.id === emailId ? { ...e, summary: data.summary } : e));
        setEmailsList(prev => prev.map(e => e.id === emailId ? { ...e, summary: data.summary } : e));
        setRecentMatches(prev => prev.map(e => e.id === emailId ? { ...e, summary: data.summary } : e));
        // Refresh tenders cache details in background
        fetchTenders();
      } else {
        alert(`Summarization failed: ${data.error}`);
      }
    } catch (err) {
      console.error('Summarize error:', err);
    } finally {
      setSummarizing(false);
    }
  };

  const tenderMap = useMemo(() => {
    const map = new Map();
    tenders.forEach(t => map.set(`${t.docketNo}|${t.tenderNoRaw}`, t));
    return map;
  }, [tenders]);

  const filteredTendersList = useMemo(() => {
    return tenders.filter(t => {
      if (!t.docketNo && !t.tenderNoRaw) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          t.client?.toLowerCase().includes(query) ||
          t.tenderNoRaw?.toLowerCase().includes(query) ||
          t.tenderFor?.toLowerCase().includes(query) ||
          t.docketNo?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }
      if (activeCompanyFilter) {
        const comp = activeCompanyFilter.toLowerCase().trim();
        const tComp = (t.tenderFor || t.company || '').toLowerCase().trim();
        const tClient = (t.client || '').toLowerCase().trim();
        if (!tComp.includes(comp) && !tClient.includes(comp)) return false;
      }
      if (subStartDate || subEndDate) {
        const subDate = parseGSheetDate(t.lastDate) || parseGSheetDate(t.docketNo);
        if (subDate) {
          const subDateStr = getLocalDateString(subDate);
          if (subStartDate && subDateStr < subStartDate) return false;
          if (subEndDate && subDateStr > subEndDate) return false;
        } else {
          return false;
        }
      }
      return true;
    });
  }, [tenders, searchQuery, subStartDate, subEndDate, excludeTenderTiger, activeCompanyFilter]);

  const dashboardFilteredTenders = filteredTendersList;

  const filteredTenders = useMemo(() => {
    let result = filteredTendersList.filter(t => {
      if (filterParticipated && !t.isParticipated && !(t.matchCount > 0)) return false;
      if (filterMatchedOnly && !(t.matchCount > 0)) return false;
      if (filterUrgentReplyOnly && !t.replyRequired) return false;
      return true;
    });

    const parseLD = (str) => {
      const dt = parseGSheetDate(str);
      return dt ? dt.getTime() : 0;
    };

    const sortMap = { date: tenderDateSort, submission: submissionDateSort, deadline: deadlineSort };
    const activeSorts = tenderSortPriority.filter(key => sortMap[key]);

    if (activeSorts.length > 0) {
      result = [...result].sort((a, b) => {
        for (const key of activeSorts) {
          const dir = sortMap[key];
          let cmp = 0;
          if (key === 'date') {
            const da = a.docketNo ? String(a.docketNo) : '';
            const db = b.docketNo ? String(b.docketNo) : '';
            cmp = dir === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
          } else if (key === 'submission') {
            const da = parseLD(a.lastDate);
            const db = parseLD(b.lastDate);
            cmp = dir === 'asc' ? da - db : db - da;
          } else if (key === 'deadline') {
            const da = a.deadlineDate ? new Date(a.deadlineDate).getTime() : 0;
            const db = b.deadlineDate ? new Date(b.deadlineDate).getTime() : 0;
            cmp = dir === 'asc' ? da - db : db - da;
          }
          if (cmp !== 0) return cmp;
        }
        return 0;
      });
    }

    return result;
  }, [filteredTendersList, filterParticipated, filterMatchedOnly, filterUrgentReplyOnly, tenderDateSort, submissionDateSort, deadlineSort, tenderSortPriority]);

  const filteredEmails = useMemo(() => {
    return emailsList.filter(email => {
      if (excludeTenderTiger && (email.sender?.toLowerCase().includes('tendertiger') || email.sender?.toLowerCase().includes('procuretiger'))) {
        return false;
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const cwMatch = email.codewords && email.codewords.some(cw => cw.toLowerCase().includes(query));
        const matchesSearch =
          cwMatch ||
          email.subject?.toLowerCase().includes(query) ||
          email.sender?.toLowerCase().includes(query) ||
          email.body?.toLowerCase().includes(query) ||
          email.matched_token?.toLowerCase().includes(query) ||
          email.tender_no?.toLowerCase().includes(query) ||
          email.docket_no?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }
      if (activeCwFilter) {
        const cws = email.codewords || [];
        if (!cws.some(cw => cw.toLowerCase() === activeCwFilter.toLowerCase())) return false;
      }
      if (recStartDate || recEndDate) {
        if (!email.date_received) return false;
        const emailDate = new Date(email.date_received);
        if (!isNaN(emailDate.getTime())) {
          const emailDateStr = getLocalDateString(emailDate);
          if (recStartDate && emailDateStr < recStartDate) return false;
          if (recEndDate && emailDateStr > recEndDate) return false;
        } else {
          return false;
        }
      }
      if (subStartDate || subEndDate) {
        const parentTender = tenderMap.get(`${email.docket_no}|${email.tender_no}`) || tenderMap.get(`docket_${email.docket_no}`) || tenderMap.get(`tender_${email.tender_no}`);
        const subDate = parentTender ? (parseGSheetDate(parentTender.lastDate) || parseGSheetDate(parentTender.docketNo)) : parseGSheetDate(email.docket_no);
        if (subDate) {
          const subDateStr = getLocalDateString(subDate);
          if (subStartDate && subDateStr < subStartDate) return false;
          if (subEndDate && subDateStr > subEndDate) return false;
        } else {
          return false;
        }
      }
      if (activeCompanyFilter) {
        const companies = email.companies || [];
        if (!companies.some(c => c.toLowerCase() === activeCompanyFilter.toLowerCase())) return false;
      }
      return true;
    }).sort((a, b) => {
      const da = new Date(a.date_received).getTime();
      const db = new Date(b.date_received).getTime();
      return dateSortOrder === 'asc' ? da - db : db - da;
    });
  }, [emailsList, searchQuery, recStartDate, recEndDate, subStartDate, subEndDate, excludeTenderTiger, tenderMap, activeCompanyFilter, activeCwFilter, dateSortOrder]);

  const dashboardFilteredRecentMatches = useMemo(() => {
    return recentMatches.filter(email => {
      if (excludeTenderTiger && (email.sender?.toLowerCase().includes('tendertiger') || email.sender?.toLowerCase().includes('procuretiger'))) {
        return false;
      }
      if (recStartDate || recEndDate) {
        if (!email.date_received) return false;
        const emailDate = new Date(email.date_received);
        if (!isNaN(emailDate.getTime())) {
          const emailDateStr = getLocalDateString(emailDate);
          if (recStartDate && emailDateStr < recStartDate) return false;
          if (recEndDate && emailDateStr > recEndDate) return false;
        } else {
          return false;
        }
      }
      if (subStartDate || subEndDate) {
        const parentTender = tenderMap.get(`${email.docket_no}|${email.tender_no}`) || tenderMap.get(`docket_${email.docket_no}`) || tenderMap.get(`tender_${email.tender_no}`);
        const subDate = parentTender ? (parseGSheetDate(parentTender.lastDate) || parseGSheetDate(parentTender.docketNo)) : parseGSheetDate(email.docket_no);
        if (subDate) {
          const subDateStr = getLocalDateString(subDate);
          if (subStartDate && subDateStr < subStartDate) return false;
          if (subEndDate && subDateStr > subEndDate) return false;
        } else {
          return false;
        }
      }
      if (activeCompanyFilter) {
        const companies = email.companies || [];
        if (!companies.some(c => c.toLowerCase() === activeCompanyFilter.toLowerCase())) return false;
      }
      return true;
    });
  }, [recentMatches, recStartDate, recEndDate, subStartDate, subEndDate, excludeTenderTiger, tenderMap, activeCompanyFilter]);

  const filteredTenderEmails = useMemo(() => {
    return tenderEmails.filter(email => {
      if (excludeTenderTiger && (email.sender?.toLowerCase().includes('tendertiger') || email.sender?.toLowerCase().includes('procuretiger'))) {
        return false;
      }
      const emailDate = email.date_received ? new Date(email.date_received) : null;
      if (emailDate && !isNaN(emailDate.getTime())) {
        const emailDateStr = getLocalDateString(emailDate);
        if (modalStartDate && emailDateStr < modalStartDate) return false;
        if (modalEndDate && emailDateStr > modalEndDate) return false;
      }
      return true;
    });
  }, [tenderEmails, modalStartDate, modalEndDate, excludeTenderTiger]);

  // Render badges: codewords first (dashed border), then companies (solid), then OUTSIDER / TEMP fallback
  const renderSenderBadges = (email) => {
    const items = [];
    if (email.codewords && email.codewords.length > 0) {
      email.codewords.forEach(cw => {
        const found = codewordsList.find(x => x.codeword === cw);
        const color = found ? (COMPANY_COLORS[found.company] || '#6b7280') : '#6b7280';
        items.push({ label: cw, color, type: 'codeword' });
      });
    } else if (email.company && email.company !== 'Outsider' && email.company !== 'OUTSIDER') {
      const comps = String(email.company).split(',').map(c => c.trim()).filter(Boolean);
      comps.forEach(c => items.push({ label: c.toUpperCase(), color: COMPANY_COLORS[c] || COMPANY_COLORS[c.toUpperCase()] || '#6b7280', type: 'company' }));
    } else if (email.companies && email.companies.length > 0 && !email.companies.includes('OUTSIDER')) {
      email.companies.forEach(c => items.push({ label: c.toUpperCase(), color: COMPANY_COLORS[c] || COMPANY_COLORS[c.toUpperCase()] || '#6b7280', type: 'company' }));
    } else if (email.fallback_company) {
      const fc = email.fallback_company;
      items.push({ label: `${fc.toUpperCase()} (TEMP)`, color: COMPANY_COLORS[fc] || '#f59e0b', type: 'temp' });
    } else {
      items.push({ label: 'OUTSIDER', color: '#6b7280', type: 'outsider' });
    }
    return items;
  };

  const renderCustomBadge = (type, label, color) => {
    const isCodeword = type === 'codeword';
    const isOutsider = type === 'outsider';
    const isTemp = type === 'temp';
    const actualColor = color || '#6b7280';
    
    const badgeStyle = isCodeword
      ? {
          borderColor: actualColor,
          color: actualColor,
          backgroundColor: `${actualColor}0a`
        }
      : isTemp
      ? {
          borderColor: '#f59e0b',
          color: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          borderStyle: 'dashed'
        }
      : isOutsider
      ? {
          backgroundColor: 'rgba(107, 114, 128, 0.1)',
          color: '#9ca3af',
          border: '1px solid rgba(107, 114, 128, 0.25)'
        }
      : {
          backgroundColor: `${actualColor}18`,
          color: actualColor,
          border: `1px solid ${actualColor}40`
        };

    const labelPrefix = isCodeword
      ? <span style={{ marginRight: '0.2rem', opacity: 0.8, fontSize: '0.8rem', fontWeight: 'bold' }}>#</span>
      : isOutsider
      ? null
      : <span style={{ marginRight: '0.35rem', fontSize: '0.9rem', lineHeight: 1, color: actualColor }}>•</span>;

    return (
      <span className={isCodeword ? 'codeword-badge' : 'company-badge'} style={badgeStyle}>
        {labelPrefix}
        {label}
      </span>
    );
  };

  const anyFiltersActive = subStartDate || subEndDate || recStartDate || recEndDate || searchQuery || excludeTenderTiger || activeCompanyFilter;

  const threadMessages = useMemo(() => {
    if (!detailedEmail?.body) return [];
    const msgs = parseEmailThread(detailedEmail.body);
    return msgs;
  }, [detailedEmail?.body]);

  const displayTendersCount = anyFiltersActive
    ? filteredTendersList.length
    : (syncInfo.tendersCount || tenders.length || 0);

  const displayParticipatedCount = anyFiltersActive
    ? filteredTendersList.filter(t => t.isParticipated).length
    : (syncInfo.participatedCount || tenders.filter(t => t.isParticipated).length || 0);

  const displayMatchedEmailsCount = anyFiltersActive
    ? (matchedEmailsTotal || filteredEmails.length)
    : (syncInfo.matchesCount || emailsList.length || 0);

  const allMatchedEmails = displayMatchedEmailsCount;

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            {/* <Mail size={22} /> */}
          </div>
          <img
            src="https://laserpowerinfra.com/wp-content/uploads/2025/09/lpi-logo.png"
            alt="Laser Power & Infra Logo"
            className="company-logo"
            style={{ width: "200px", height: "auto" }}
          />

          {/* <span className="brand-name">TenderPortal</span> */}
        </div>

        <nav style={{ flexGrow: 1 }}>
          <ul className="nav-menu">
            <li
              className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              <TrendingUp />
              Dashboard
            </li>
            <li
              className={`nav-item ${activeTab === 'tenders' ? 'active' : ''}`}
              onClick={() => setActiveTab('tenders')}
            >
              <FileText />
              Tenders Directory
            </li>
            <li
              className={`nav-item ${activeTab === 'emails' ? 'active' : ''}`}
              onClick={() => setActiveTab('emails')}
            >
              <Mail />
              Matched Emails
            </li>
            <li
              className={`nav-item ${activeTab === 'all-emails' ? 'active' : ''}`}
              onClick={() => setActiveTab('all-emails')}
            >
              <Mail />
              All Emails Explorer
            </li>
            <li
              className={`nav-item ${activeTab === 'sender-mapping' ? 'active' : ''}`}
              onClick={() => setActiveTab('sender-mapping')}
            >
              <User />
              Sender Mapping
            </li>
            <li
              className={`nav-item ${activeTab === 'rules' ? 'active' : ''}`}
              onClick={() => setActiveTab('rules')}
            >
              <ShieldAlert />
              AI Knowledge Base
            </li>
            <li
              className={`nav-item ${activeTab === 'config' ? 'active' : ''}`}
              onClick={() => setActiveTab('config')}
            >
              <Settings />
              System Config
            </li>
          </ul>
        </nav>

        <div className="sidebar-footer">
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={triggerSync}
            disabled={syncing}
          >
            <RefreshCw className={syncing ? 'spinner' : ''} size={16} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
            {syncing ? 'Syncing...' : 'Sync Portal'}
          </button>
        </div>
      </aside>

      {/* Main Content View */}
      <main className="main-content">
        <header className="header-bar">
          <div className="header-title">
            {/* <img src="https://laserpowerinfra.com/wp-content/uploads/2025/09/lpi-logo.png" alt="Company Logo" className="company-logo" /> */}
            <h1>
              {activeTab === 'dashboard' && 'Dashboard'}
              {activeTab === 'tenders' && 'Tenders Directory'}
              {activeTab === 'emails' && 'Matched Emails'}
              {activeTab === 'all-emails' && 'All Emails Explorer'}
              {activeTab === 'sender-mapping' && 'Sender Mapping'}
              {activeTab === 'config' && 'System Config'}
              {activeTab === 'rules' && 'AI Knowledge Base'}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                {activeTab === 'dashboard' && 'Visual overview of participated tenders and email status'}
                {activeTab === 'tenders' && 'Manage GSheet synced tenders and matching emails'}
                {activeTab === 'emails' && 'Directory of all matched emails across all tenders'}
                {activeTab === 'all-emails' && 'Explore and label all incoming emails with smart categories'}
                {activeTab === 'sender-mapping' && 'Upload sender names and assign company mappings'}
                {activeTab === 'config' && 'Verify Google API, MySQL credentials, and column mappings'}
                {activeTab === 'rules' && 'Define guidelines and rules to train the AI to filter out wrong email matches'}
              </p>
              {status.dbFallbackActive ? (
                <span className="badge badge-warning" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', textTransform: 'uppercase', fontWeight: 600 }}>
                  <AlertCircle size={10} /> Offline Fallback Active
                </span>
              ) : status.database ? (
                <span className="badge badge-success" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', textTransform: 'uppercase', fontWeight: 600 }}>
                  <CheckCircle2 size={10} /> Cloud Connected
                </span>
              ) : null}
            </div>
          </div>

          <div className="header-actions">
            <div className="search-wrapper">
              <Search className="search-icon" />
              <input
                type="text"
                placeholder="Search Client, Tender No, Keyword..."
                className="search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {/* Theme buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                className={`btn btn-dark ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => applyTheme('dark')}
              >
                Dark Theme
              </button>

              <button
                className={`btn btn-pink ${theme === 'pink' ? 'active' : ''}`}
                onClick={() => applyTheme('pink')}
              >
                Light Pink
              </button>

              {status.sheetId && (
                <a
                  href={status.sheetUrl || `https://docs.google.com/spreadsheets/d/${status.sheetId}/edit#gid=${status.sheetGid || 0}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', padding: '0.4rem 0.75rem' }}
                  title="Open synced Google Sheet in new tab"
                >
                  <ExternalLink size={14} /> Open Google Sheet
                </a>
              )}
            </div>
            {activeTab === 'tenders' && (
              <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={filterParticipated}
                    onChange={(e) => setFilterParticipated(e.target.checked)}
                  />
                  Participated Only
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={filterMatchedOnly}
                    onChange={(e) => setFilterMatchedOnly(e.target.checked)}
                  />
                  Matched Emails Only
                </label>
              </div>
            )}

            
          </div>
        </header>

        {/* Global Filter Bar */}
        <div className="global-filter-bar">
          <div className="filter-group">
            <div className="filter-group-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '1.5rem' }}>
              <span className="filter-label"><Calendar size={14} /> Submission Date</span>
              <div className="filter-mode-switch">
                <button 
                  className={`filter-mode-btn ${subFilterMode === 'range' ? 'active' : ''}`}
                  onClick={() => setSubFilterMode('range')}
                >
                  Range
                </button>
                <button 
                  className={`filter-mode-btn ${subFilterMode === 'interval' ? 'active' : ''}`}
                  onClick={() => setSubFilterMode('interval')}
                >
                  Interval
                </button>
              </div>
            </div>

            <div className="filter-group-body" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', minHeight: '32px' }}>
              {subFilterMode === 'range' ? (
                <>
                  <input
                    type="date"
                    className="filter-input"
                    value={subStartDate}
                    onChange={(e) => setSubStartDate(e.target.value)}
                  />
                  <span className="filter-separator">to</span>
                  <input
                    type="date"
                    className="filter-input"
                    value={subEndDate}
                    onChange={(e) => setSubEndDate(e.target.value)}
                  />
                </>
              ) : (
                <div className="filter-interval-control">
                  <select
                    className="filter-select"
                    value={subIntervalDir}
                    onChange={(e) => setSubIntervalDir(e.target.value)}
                  >
                    <option value="next" style={{ background: '#1f1f1f' }}>Next</option>
                    <option value="last" style={{ background: '#1f1f1f' }}>Last</option>
                  </select>
                  <input
                    type="number"
                    className="filter-input-number"
                    placeholder="No."
                    min="1"
                    value={subIntervalValue}
                    onChange={(e) => setSubIntervalValue(e.target.value)}
                  />
                  <select
                    className="filter-select"
                    value={subIntervalUnit}
                    onChange={(e) => setSubIntervalUnit(e.target.value)}
                  >
                    <option value="days" style={{ background: '#1f1f1f' }}>Days</option>
                    <option value="months" style={{ background: '#1f1f1f' }}>Months</option>
                  </select>
                </div>
              )}
              
              {(subStartDate || subEndDate || subIntervalValue) && (
                <button className="btn-clear" onClick={handleClearSubFilter}>✕</button>
              )}
            </div>
          </div>

          <div className="filter-group">
            <div className="filter-group-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '1.5rem' }}>
              <span className="filter-label"><Clock size={14} /> Email Received</span>
              <div className="filter-mode-switch">
                <button 
                  className={`filter-mode-btn ${recFilterMode === 'range' ? 'active' : ''}`}
                  onClick={() => setRecFilterMode('range')}
                >
                  Range
                </button>
                <button 
                  className={`filter-mode-btn ${recFilterMode === 'interval' ? 'active' : ''}`}
                  onClick={() => setRecFilterMode('interval')}
                >
                  Interval
                </button>
              </div>
            </div>

            <div className="filter-group-body" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', minHeight: '32px' }}>
              {recFilterMode === 'range' ? (
                <>
                  <input
                    type="date"
                    className="filter-input"
                    value={recStartDate}
                    onChange={(e) => setRecStartDate(e.target.value)}
                  />
                  <span className="filter-separator">to</span>
                  <input
                    type="date"
                    className="filter-input"
                    value={recEndDate}
                    onChange={(e) => setRecEndDate(e.target.value)}
                  />
                </>
              ) : (
                <div className="filter-interval-control">
                  <select
                    className="filter-select"
                    value={recIntervalDir}
                    onChange={(e) => setRecIntervalDir(e.target.value)}
                  >
                    <option value="last" style={{ background: '#1f1f1f' }}>Last</option>
                    <option value="next" style={{ background: '#1f1f1f' }}>Next</option>
                  </select>
                  <input
                    type="number"
                    className="filter-input-number"
                    placeholder="No."
                    min="1"
                    value={recIntervalValue}
                    onChange={(e) => setRecIntervalValue(e.target.value)}
                  />
                  <select
                    className="filter-select"
                    value={recIntervalUnit}
                    onChange={(e) => setRecIntervalUnit(e.target.value)}
                  >
                    <option value="days" style={{ background: '#1f1f1f' }}>Days</option>
                    <option value="months" style={{ background: '#1f1f1f' }}>Months</option>
                  </select>
                </div>
              )}

              {(recStartDate || recEndDate || recIntervalValue) && (
                <button className="btn-clear" onClick={handleClearRecFilter}>✕</button>
              )}
            </div>
          </div>

          <div className="filter-group-right">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={excludeTenderTiger}
                onChange={(e) => setExcludeTenderTiger(e.target.checked)}
              />
              Exclude @tendertiger.com
            </label>
          </div>
        </div>

        {/* ── Company & Codeword Filter Bars ── */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem',
          padding: '0.75rem 1.25rem',
          margin: '0.5rem 0 0 0',
          background: 'rgba(255,255,255,0.02)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          {/* Company row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              whiteSpace: 'nowrap', paddingRight: '0.6rem',
              borderRight: '1px solid rgba(255,255,255,0.1)',
              minWidth: '90px'
            }}>
              <Building2 size={12} /> Company
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
              {['', ...COMPANY_LIST, 'OUTSIDER'].map(c => {
                const color = c ? COMPANY_COLORS[c] : null;
                const isActive = activeCompanyFilter === c;
                const btnStyle = c
                  ? isActive
                    ? { backgroundColor: color, borderColor: color, color: '#fff' }
                    : { backgroundColor: `${color}18`, borderColor: `${color}50`, color: color }
                  : isActive
                    ? { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.3)', color: '#fff' }
                    : { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.12)', color: 'var(--text-muted)' };
                return (
                  <button
                    key={c || 'all'}
                    className={`company-filter-btn ${isActive ? 'active' : ''}`}
                    style={btnStyle}
                    onClick={() => setActiveCompanyFilter(isActive ? '' : c)}
                  >
                    {c || 'All'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Codeword row — shown when codewords exist */}
          {codewordsList.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
                whiteSpace: 'nowrap', paddingRight: '0.6rem',
                borderRight: '1px solid rgba(255,255,255,0.1)',
                minWidth: '90px'
              }}>
                <Filter size={12} /> Codeword
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
                {[null, ...codewordsList].map((cw) => {
                  const label = cw ? cw.codeword : 'All';
                  const key = cw ? cw.codeword : 'all-cw';
                  const color = cw ? (COMPANY_COLORS[cw.company] || '#818cf8') : null;
                  const isActive = activeCwFilter === (cw ? cw.codeword : '');
                  const btnStyle = cw
                    ? isActive
                      ? { backgroundColor: color, borderColor: color, color: '#fff' }
                      : { backgroundColor: `${color}18`, borderColor: `${color}55`, color: color }
                    : isActive
                      ? { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.3)', color: '#fff' }
                      : { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.12)', color: 'var(--text-muted)' };
                  return (
                    <button
                      key={key}
                      className={`company-filter-btn ${isActive ? 'active' : ''}`}
                      style={btnStyle}
                      onClick={() => setActiveCwFilter(isActive ? '' : (cw ? cw.codeword : ''))}
                      title={cw ? `${cw.company} · ${cw.category} · ${cw.sub_category}` : 'Show all'}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 1. DASHBOARD VIEW */}
        {activeTab === 'dashboard' && (
          <div>
            {/* Stats widgets */}
            <div className="stats-grid">
              <div className="card">
                <div className="stat-header">
                  <span>Synced Tenders</span>
                  <FileText size={18} />
                </div>
                <div className="stat-value">{displayTendersCount}</div>
                <div className="stat-desc">Total rows retrieved from Google Sheets</div>
              </div>

              <div className="card">
                <div className="stat-header">
                  <span>Participated Tenders</span>
                  <Briefcase size={18} />
                </div>
                <div className="stat-value" style={{ color: 'var(--color-primary-light)' }}>
                  {displayParticipatedCount}
                </div>
                <div className="stat-desc">Tenders marked as 'YES' for participation</div>
              </div>

              <div className="card">
                <div className="stat-header">
                  <span>Matched Emails</span>
                  <Mail size={18} />
                </div>
                <div className="stat-value" style={{ color: 'var(--color-success)' }}>
                  {displayMatchedEmailsCount}
                </div>
                <div className="stat-desc">Total emails matched with all tenders</div>
              </div>

              <div className="card">
                <div className="stat-header">
                  <span>System Health</span>
                  <Clock size={18} />
                </div>
                <div className="stat-value" style={{ fontSize: '1.25rem', paddingTop: '0.4rem', color: (status.database && status.sheetsAuth) ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {(status.database && status.sheetsAuth) ? 'FULLY SYNCED' : 'SETUP REQUIRED'}
                </div>
                <div className="stat-desc">
                  {syncInfo.lastSynced ? `Last Synced: ${new Date(syncInfo.lastSynced).toLocaleString()}` : 'Never synced'}
                </div>
              </div>
            </div>

            {/* Notifications Center */}
            <div className="card" style={{ marginBottom: '2rem', borderLeft: '4px solid var(--color-secondary)', background: 'linear-gradient(to right, rgba(6, 182, 212, 0.05), transparent)' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '1.05rem', color: 'var(--text-main)' }}>
                <Mail size={16} color="var(--color-secondary)" />
                Recent Alerts & Notifications
              </h3>
              {dashboardFilteredRecentMatches.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No matched emails found yet. Click 'Sync Portal' to search your email database.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  {dashboardFilteredRecentMatches
                    .slice(0, 5)
                    .map(email => {
                      const isNew = (new Date() - new Date(email.date_received)) / (1000 * 60 * 60) <= 48;
                      return (
                        <div
                          key={`${email.id}-${email.docket_no || ''}-${email.tender_no || ''}`}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid var(--border-color)',
                            padding: '0.65rem 1rem',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '0.85rem'
                          }}
                          className="card-interactive"
                        onClick={() => openMatchChat(email)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
                            {isNew ? (
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-secondary)', boxShadow: '0 0 8px var(--color-secondary)' }}></span>
                            ) : (
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--text-muted)' }}></span>
                            )}
                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <strong style={{ color: 'var(--text-main)' }}>{email.subject}</strong>
                              <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>matched tender ID "{email.matched_token}"</span>
                              <div className="company-badge-list" style={{ marginTop: '0.2rem' }}>
                                {renderSenderBadges(email).map((b, i) => (
                                  <React.Fragment key={i}>
                                    {renderCustomBadge(b.type, b.label, b.color)}
                                  </React.Fragment>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                            <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>Docket: {email.docket_no}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{formatDateTime(email.date_received)}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Dashboard body columns */}
            <div className="dashboard-layout">
              {/* Left Column: Tenders with matching emails */}
              <div>
                <div className="section-title">
                  <h2>Participated Tenders (Recent matches)</h2>
                  <button className="btn btn-secondary" onClick={() => setActiveTab('tenders')}>View All</button>
                </div>

                {loading && tenders.length === 0 ? (
                  <div className="loading-container"><div className="spinner"></div></div>
                ) : dashboardFilteredTenders.filter(t => t.isParticipated || t.matchCount > 0).length === 0 ? (
                  <div className="empty-state">
                    <Info size={40} />
                    <h3>No Matched or Participated Tenders</h3>
                    <p>No tenders match the selected company/date filters. Try clearing filters or syncing.</p>
                  </div>
                ) : (
                  <div className="tenders-list" style={{ opacity: loading ? 0.75 : 1, transition: 'opacity 0.2s' }}>
                    {dashboardFilteredTenders
                      .filter(t => t.isParticipated || t.matchCount > 0)
                      .sort((a, b) => {
                        const da = parseGSheetDate(a.lastDate) || parseGSheetDate(a.docketNo) || (a.latestEmailDate ? new Date(a.latestEmailDate) : null);
                        const db = parseGSheetDate(b.lastDate) || parseGSheetDate(b.docketNo) || (b.latestEmailDate ? new Date(b.latestEmailDate) : null);
                        const ta = da ? da.getTime() : 0;
                        const tb = db ? db.getTime() : 0;
                        return tb - ta;
                      })
                      .slice(0, 5)
                      .map(t => (
                        <div
                          key={t.rowNumber}
                          className="card card-interactive tender-card"
                          onClick={() => loadTenderEmails(t)}
                        >
                          <div className="tender-header">
                            <div>
                              <div className="tender-title">{t.tenderFor || 'Tender Item'}</div>
                              <div className="tender-client">{t.client || 'Unknown Client'}</div>
                            </div>
                            <span className="badge badge-success">{t.matchCount} emails</span>
                          </div>

                          <div className="tender-details">
                            <div className="detail-item">
                              <span style={{ fontWeight: 600 }}>Tender No:</span> {t.tenderNoRaw.substring(0, 60)}...
                            </div>
                            <div className="detail-item">
                              <Calendar size={12} />
                              <span>Last Date: {t.lastDate || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Right Column: Health and Info */}
              <div>
                <div className="section-title">
                  <h2>Connection Status</h2>
                </div>

                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <Database size={20} color={status.database ? 'var(--color-success)' : 'var(--color-danger)'} />
                      <div>
                        <div style={{ fontWeight: 600 }}>MySQL Connection</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {status.database ? 'Connected successfully' : 'Disconnected'}
                        </div>
                      </div>
                    </div>
                    <span className={`badge ${status.database ? 'badge-success' : 'badge-danger'}`}>
                      {status.database ? 'OK' : 'FAIL'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <FileText size={20} color={status.sheetsAuth ? 'var(--color-success)' : 'var(--color-danger)'} />
                      <div>
                        <div style={{ fontWeight: 600 }}>Google Sheets Auth</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {status.sheetsAuth ? 'Authorized & connected' : 'Unauthorized'}
                        </div>
                      </div>
                    </div>
                    <span className={`badge ${status.sheetsAuth ? 'badge-success' : 'badge-danger'}`}>
                      {status.sheetsAuth ? 'OK' : 'FAIL'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <Key size={20} color={status.openaiKey ? 'var(--color-success)' : 'var(--color-warning)'} />
                      <div>
                        <div style={{ fontWeight: 600 }}>AI Engine ({status.aiProvider ? (status.aiProvider.charAt(0).toUpperCase() + status.aiProvider.slice(1)) : 'AI'})</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {status.openaiKey 
                            ? `${status.aiProvider ? (status.aiProvider.charAt(0).toUpperCase() + status.aiProvider.slice(1)) : 'AI'} active (${status.aiModel || ''})` 
                            : 'AI offline, using regex fallback'}
                        </div>
                      </div>
                    </div>
                    <span className={`badge ${status.openaiKey ? 'badge-success' : 'badge-warning'}`}>
                      {status.openaiKey ? 'ACTIVE' : 'FALLBACK'}
                    </span>
                  </div>

                  {(!status.database || !status.sheetsAuth) && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setActiveTab('config')}>
                        <Info size={16} />
                        View Setup Instructions
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. TENDERS DIRECTORY */}
        {activeTab === 'tenders' && (
          <div>
            {loading && tenders.length === 0 ? (
              <div className="loading-container">
                <div className="spinner"></div>
                <p>Loading Tenders from GSheet Cache...</p>
              </div>
            ) : filteredTenders.length === 0 ? (
              <div className="empty-state">
                <Info size={40} />
                <h3>No Tenders Found</h3>
                <p>Try clearing your search query or sync the portal.</p>
              </div>
            ) : (
              <div className="table-container" style={{ opacity: loading ? 0.75 : 1, transition: 'opacity 0.2s' }}>
                <table className="tenders-table">
                  <thead>
                    <tr>
                      <th>
                        <button
                          className="sort-th-btn"
                          onClick={() => {
                            setTenderDateSort(s => {
                              const next = s === 'asc' ? 'desc' : s === 'desc' ? '' : 'asc';
                              if (next) setTenderSortPriority(prev => ['date', ...prev.filter(k => k !== 'date')]);
                              return next;
                            });
                          }}
                          title={`Sort by Date${tenderDateSort ? ` (${tenderSortPriority.filter(k=>k==='date'||submissionDateSort&&k==='submission'||deadlineSort&&k==='deadline').indexOf('date')+1})` : ''}`}
                        >
                          Date
                          {tenderDateSort
                            ? <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:'1.2rem', height:'1.2rem', borderRadius:'4px', background:'rgba(99,102,241,0.25)', border:'1.5px solid rgba(99,102,241,0.5)', fontSize:'0.75rem', fontWeight:800, color:'#818cf8', marginLeft:'0.25rem' }}>{tenderDateSort === 'asc' ? '↑' : '↓'}</span>
                            : <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:'1.2rem', height:'1.2rem', borderRadius:'4px', background:'rgba(255,255,255,0.05)', border:'1px dashed rgba(255,255,255,0.15)', fontSize:'0.75rem', color:'rgba(255,255,255,0.25)', marginLeft:'0.25rem' }}>↕</span>
                          }
                        </button>
                      </th>
                      <th>Tender For / Description</th>
                      <th>Client</th>
                      {/* <th>Participated</th> */}
                      <th>
                        <button
                          className="sort-th-btn"
                          onClick={() => {
                            setSubmissionDateSort(s => {
                              const next = s === 'asc' ? 'desc' : s === 'desc' ? '' : 'asc';
                              if (next) setTenderSortPriority(prev => ['submission', ...prev.filter(k => k !== 'submission')]);
                              return next;
                            });
                          }}
                          title={`Sort by Submission Date${submissionDateSort ? ' (active)' : ''}`}
                        >
                          Submission Date
                          {submissionDateSort
                            ? <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:'1.2rem', height:'1.2rem', borderRadius:'4px', background:'rgba(16,185,129,0.25)', border:'1.5px solid rgba(16,185,129,0.5)', fontSize:'0.75rem', fontWeight:800, color:'#34d399', marginLeft:'0.25rem' }}>{submissionDateSort === 'asc' ? '↑' : '↓'}</span>
                            : <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:'1.2rem', height:'1.2rem', borderRadius:'4px', background:'rgba(255,255,255,0.05)', border:'1px dashed rgba(255,255,255,0.15)', fontSize:'0.75rem', color:'rgba(255,255,255,0.25)', marginLeft:'0.25rem' }}>↕</span>
                          }
                        </button>
                      </th>
                      {/* <th>Status</th> */}
                      <th>Matched Emails</th>
                      <th>Senders</th>
                      <th>
                        <button
                          className="sort-th-btn"
                          onClick={() => {
                            setDeadlineSort(s => {
                              const next = s === 'asc' ? 'desc' : s === 'desc' ? '' : 'asc';
                              if (next) setTenderSortPriority(prev => ['deadline', ...prev.filter(k => k !== 'deadline')]);
                              return next;
                            });
                          }}
                          title={`Sort by Extracted Deadline${deadlineSort ? ' (active)' : ''}`}
                        >
                          Extracted Deadline
                          {deadlineSort
                            ? <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:'1.2rem', height:'1.2rem', borderRadius:'4px', background:'rgba(245,158,11,0.25)', border:'1.5px solid rgba(245,158,11,0.5)', fontSize:'0.75rem', fontWeight:800, color:'#fbbf24', marginLeft:'0.25rem' }}>{deadlineSort === 'asc' ? '↑' : '↓'}</span>
                            : <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:'1.2rem', height:'1.2rem', borderRadius:'4px', background:'rgba(255,255,255,0.05)', border:'1px dashed rgba(255,255,255,0.15)', fontSize:'0.75rem', color:'rgba(255,255,255,0.25)', marginLeft:'0.25rem' }}>↕</span>
                          }
                        </button>
                      </th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTenders.map((t, idx) => (
                      <tr key={`${t.rowNumber ?? 'r'}-${idx}`}>
                        <td style={{ fontWeight: 600 }}>{t.docketNo || 'N/A'}</td>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{t.tenderFor || 'Tender Item'}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.tenderNoRaw}
                          </div>
                        </td>
                        <td>{t.client || 'N/A'}</td>
                        {/* <td>
                          <span className={`badge ${t.isParticipated ? 'badge-success' : 'badge-muted'}`}>
                            {t.participated || 'NO'}
                          </span>
                        </td> */}
                        <td>{t.lastDate || 'N/A'}</td>
                        {/* <td>
                          <span className={`badge ${
                            t.status?.toLowerCase().includes('awarded') ? 'badge-success' :
                            t.status?.toLowerCase().includes('cancelled') ? 'badge-danger' :
                            t.status?.toLowerCase().includes('clarification') ? 'badge-warning' :
                            t.status?.toLowerCase().includes('submitted') ? 'badge-info' :
                            t.status?.toLowerCase().includes('opened') ? 'badge-secondary' :
                            'badge-muted'
                          }`}>
                            {t.status || 'Active'}
                          </span>
                        </td> */}
                        <td>
                          {t.matchCount > 0 ? (
                            <span className="badge badge-info">
                              {t.matchCount} matched
                            </span>
                          ) : t.isParticipated ? (
                            <span className="badge badge-muted">
                              0 matched
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Not Tracked</span>
                          )}
                        </td>
                        <td>
                          {t.senders && t.senders.length > 0 ? (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.25rem',
                                fontSize: '0.8rem',
                                color: 'var(--text-muted)',
                                maxWidth: '200px'
                              }}
                              title={t.senders.join(', ')}
                            >
                              {t.senders.map((s, idx) => {
                                // Extract clean sender name/email
                                let name = s;
                                if (s.includes('<')) {
                                  name = s.substring(0, s.indexOf('<')).trim();
                                  // Strip leading/trailing escaped quotes
                                  name = name.replace(/^["']|["']$/g, '').trim();
                                  if (!name) name = s;
                                }
                                return (
                                  <div
                                    key={idx}
                                    style={{
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis'
                                    }}
                                    title={s}
                                  >
                                    {name}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>-</span>
                          )}
                        </td>
                        <td>
                          {t.matchCount > 0 && t.deadlineDate && !isSentinelDate(t.deadlineDate)  && t.replyRequired ? (
                            <span
                              style={{
                                fontWeight: 600,
                                color: isDeadlinePastOrToday(t.deadlineDate) ? 'red' : 'var(--color-primary-light)',
                              }}
                            >
                              {formatDateTime(t.deadlineDate)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                              -
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {t.isParticipated || t.matchCount > 0 ? (
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                              {t.replyRequired ? (
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                  <span className="badge badge-danger" title={t.replyReason || 'Latest email requires a reply'}>
                                    Urgent Reply
                                  </span>
                                  <button
                                    className="btn btn-primary"
                                    style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}
                                    onClick={(e) => { e.stopPropagation(); handleOpenReplyModal(t); }}
                                    title={t.replyReason || 'Generate reply to the latest matched email'}
                                  >
                                    <Send size={12} />
                                    Reply
                                  </button>
                                  
                                  {/* AI Auto-Send Button */}
                                  <button
                                    className="btn"
                                    style={{ 
                                      padding: '0.35rem 0.6rem', 
                                      fontSize: '0.78rem',
                                      backgroundColor: '#7c3aed',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '6px',
                                      fontWeight: '600',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.25rem',
                                      cursor: 'pointer',
                                      boxShadow: '0 2px 4px rgba(124, 58, 237, 0.2)',
                                      opacity: quickReplyLoading[t.rowNumber] ? 0.7 : 1
                                    }}
                                    onClick={(e) => { e.stopPropagation(); handleQuickAutoReply(t); }}
                                    disabled={quickReplyLoading[t.rowNumber]}
                                    title="Generate suggested reply and send it immediately using AI"
                                  >
                                    {quickReplyLoading[t.rowNumber] ? (
                                      <span className="spinner-mini" style={{ width: '12px', height: '12px', border: '2px solid white', borderTop: '2px solid transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 1s linear infinite' }}></span>
                                    ) : (
                                      <Zap size={12} />
                                    )}
                                    {quickReplyLoading[t.rowNumber] ? 'Sending...' : 'AI Auto-Send'}
                                  </button>
                                </div>
                              ) : t.matchCount > 0 ? (
                                <span className="badge badge-muted" title={t.replyReason || 'Latest email does not need reply'}>
                                  No Reply Needed
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>-</span>
                              )}

                              <button
                                className="btn btn-secondary"
                                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                                onClick={() => loadTenderEmails(t)}
                              >
                                <Maximize2 size={12} />
                                Inspect
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>N/A</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 3. CONFIGURATION VIEW */}
        {activeTab === 'config' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className="card">
              <h2 style={{ marginBottom: '1rem' }}>Active Config & Status</h2>
              <div className="config-grid">

                <div className="config-item">
                  <div className="config-label">MySQL Database Server</div>
                  <div className="config-value-wrapper">
                    <div className={`config-status-dot ${status.database ? 'success' : 'error'}`}></div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{status.dbHost}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Database: {status.dbName} | Table: {status.dbTable}</div>
                    </div>
                  </div>
                </div>

                <div className="config-item">
                  <div className="config-label">Google Sheet ID</div>
                  <div className="config-value-wrapper">
                    <div className={`config-status-dot ${status.sheetsAuth ? 'success' : 'error'}`}></div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', width: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {status.sheetId}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>GID Tab: {status.sheetGid}</div>
                      {status.sheetId && (
                        <div style={{ marginTop: '0.25rem' }}>
                          <a
                            href={status.sheetUrl || `https://docs.google.com/spreadsheets/d/${status.sheetId}/edit#gid=${status.sheetGid || 0}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--color-primary-light)', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', textDecoration: 'underline', fontWeight: 600 }}
                          >
                            Open Sheet in Browser <ExternalLink size={12} />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="config-item">
                  <div className="config-label">AI Engine Status ({status.aiProvider ? (status.aiProvider.charAt(0).toUpperCase() + status.aiProvider.slice(1)) : 'AI'})</div>
                  <div className="config-value-wrapper">
                    <div className={`config-status-dot ${status.openaiKey ? 'success' : 'warn'}`}></div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{status.openaiKey ? 'Configured & Active' : 'Not Configured'}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {status.openaiKey ? `Active Model: ${status.aiModel || ''}` : 'Regex Fallback Active'}
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Instruction manual */}
            <div className="card" style={{ borderLeft: '4px solid var(--color-primary)' }}>
              <h2 style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Info color="var(--color-primary-light)" />
                Setup Guide & Requirements
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', fontSize: '0.9rem' }}>

                <div>
                  <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>1. Google Sheets Credentials Setup</h3>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    To allow the portal to fetch your sheet, place your Google Sheets API token files in the root folder of the project:
                  </p>
                  <ul style={{ paddingLeft: '1.5rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <li><strong style={{ color: 'var(--text-main)' }}>credentials.json</strong>: The Google Cloud desktop/web client credentials.</li>
                    <li><strong style={{ color: 'var(--text-main)' }}>token.json</strong>: The OAuth2 access token for your Google user account.</li>
                  </ul>
                </div>

                <div>
                  <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>2. MySQL Schema Requirements</h3>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    By default, the database table mapping is read from the <strong style={{ color: 'var(--text-main)' }}>.env</strong> file. Ensure your MySQL contains a table with standard columns:
                  </p>
                  <pre style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '6px', fontSize: '0.75rem', overflowX: 'auto', border: '1px solid var(--border-color)', color: 'var(--color-secondary)' }}>
                    {`CREATE TABLE emails (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  sender VARCHAR(100),
  date_received DATETIME NOT NULL
);`}
                  </pre>
                  <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    You can map these to any existing custom database columns inside the <strong style={{ color: 'var(--text-main)' }}>.env</strong> file.
                  </p>
                </div>

                <div>
                  <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>3. How to verify using Mock Database</h3>
                  <p style={{ color: 'var(--text-muted)' }}>
                    If you want to quickly test the portal without importing your production emails, fill in the MySQL server details in the <strong style={{ color: 'var(--text-main)' }}>.env</strong> file and run the following command in your terminal:
                  </p>
                  <pre style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--text-main)', marginTop: '0.5rem', border: '1px solid var(--border-color)' }}>
                    node setup-mock-db.js
                  </pre>
                  <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    This will automatically create a mock database and populate it with emails matching your Google Sheet tender list.
                  </p>
                </div>

              </div>
            </div>
          </div>
        )}

        {/* SENDER MAPPING TAB */}
        {activeTab === 'sender-mapping' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* ========== CODEWORDS CATALOG ========== */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 1rem 0', fontSize: '1.05rem' }}>
                <Filter size={18} /> Codewords Catalog
                <span className="badge badge-info" style={{ fontSize: '0.75rem' }}>{codewordsList.length}</span>
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <select className="filter-select" value={newCwCompany} onChange={e => { const v = e.target.value; setNewCwCompany(v); setNewCodeword(autoGenerateCodeword(v, newCwCategory, newCwSubCategory)); }} style={{ width: '120px' }}>
                    <option value="">Company</option>
                    {COMPANY_LIST.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select className="filter-select" value={newCwCategory} onChange={e => { const v = e.target.value; setNewCwCategory(v); fetchSubCategories(v, setCwAvailableSubCategories); setNewCodeword(autoGenerateCodeword(newCwCompany, v, newCwSubCategory)); }} style={{ width: '160px' }}>
                    <option value="">Category</option>
                    {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select className="filter-select" value={newCwSubCategory} onChange={e => { const v = e.target.value; setNewCwSubCategory(v); setNewCodeword(autoGenerateCodeword(newCwCompany, newCwCategory, v)); }} disabled={!newCwCategory} style={{ width: '160px' }}>
                    <option value="">Sub-category (optional)</option>
                    {cwAvailableSubCategories.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input type="text" placeholder="Codeword (auto)" className="search-input" value={newCodeword} onChange={e => setNewCodeword(e.target.value)} style={{ width: '130px', padding: '0.4rem 0.6rem', fontWeight: 600 }} />
                  <input type="text" placeholder="Description (optional)" className="search-input" value={newCwDesc} onChange={e => setNewCwDesc(e.target.value)} style={{ width: '180px', padding: '0.4rem 0.6rem' }} />
                  <button className="btn btn-primary" onClick={handleAddCodeword} disabled={!newCodeword.trim() || !newCwCompany || !newCwCategory.trim()} style={{ padding: '0.4rem 0.9rem' }}>Add</button>
                </div>
              </div>
              {codewordsList.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table className="mappings-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Codeword</th>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Company</th>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Category</th>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Sub-category</th>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Description</th>
                        <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {codewordsList.map(cw => (
                        <tr key={cw.id}>
                          <td style={{ padding: '0.4rem 0.75rem', fontWeight: 600 }}>
                            {editCodewordId === cw.id ? (
                              <input className="search-input" value={editCodewordData.codeword || ''} onChange={e => setEditCodewordData({...editCodewordData, codeword: e.target.value})} style={{ width: '100px', padding: '0.2rem 0.4rem' }} />
                            ) : (
                              renderCustomBadge('codeword', cw.codeword, COMPANY_COLORS[cw.company])
                            )}
                          </td>
                          <td style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>
                            {editCodewordId === cw.id ? (
                              <select className="filter-select" value={editCodewordData.company || ''} onChange={e => setEditCodewordData({...editCodewordData, company: e.target.value})} style={{ width: '100px' }}>
                                {COMPANY_LIST.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            ) : (
                              renderCustomBadge('company', cw.company, COMPANY_COLORS[cw.company])
                            )}
                          </td>
                          <td style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>
                            {editCodewordId === cw.id ? (
                              <select className="filter-select" value={editCodewordData.category || ''} onChange={e => { const v = e.target.value; setEditCodewordData({...editCodewordData, category: v}); fetchSubCategories(v, setEditAvailableSubCategories); }} style={{ width: '120px' }}>
                                {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            ) : cw.category}
                          </td>
                          <td style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>
                            {editCodewordId === cw.id ? (
                              <select className="filter-select" value={editCodewordData.sub_category || ''} onChange={e => setEditCodewordData({...editCodewordData, sub_category: e.target.value})} disabled={!editCodewordData.category} style={{ width: '120px' }}>
                                <option value="">Select</option>
                                {editAvailableSubCategories.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            ) : cw.sub_category}
                          </td>
                          <td style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {editCodewordId === cw.id ? (
                              <input className="search-input" value={editCodewordData.description || ''} onChange={e => setEditCodewordData({...editCodewordData, description: e.target.value})} style={{ width: '120px', padding: '0.2rem 0.4rem' }} />
                            ) : cw.description || '-'}
                          </td>
                          <td style={{ padding: '0.4rem 0.75rem', textAlign: 'center' }}>
                            {editCodewordId === cw.id ? (
                              <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                                <button className="btn btn-small btn-primary" onClick={handleUpdateCodeword} style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}>Save</button>
                                <button className="btn btn-small btn-secondary" onClick={() => { setEditCodewordId(null); setEditCodewordData({}); }} style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}>Cancel</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                                <button className="btn btn-small btn-secondary" onClick={() => { setEditCodewordId(cw.id); setEditCodewordData({ codeword: cw.codeword, company: cw.company, category: cw.category, sub_category: cw.sub_category, description: cw.description }); }} title="Edit"><Edit3 size={12} /></button>
                                <button className="btn btn-small btn-danger" onClick={() => { if (confirm(`Delete codeword "${cw.codeword}"?`)) handleDeleteCodeword(cw.id); }} title="Delete"><Trash2 size={12} /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ========== EXCEL UPLOAD ========== */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 1rem 0', fontSize: '1.05rem' }}>
                <Upload size={18} /> Upload Excel File
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleFilePreview(e.target.files[0])} style={{ color: 'var(--text-main)' }} />
                {uploadPreview && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    <p>File: <strong>{uploadPreview.fileName}</strong> — {uploadPreview.total} sender(s) detected</p>
                    {uploadPreview.sample.length > 0 && (
                      <div><p>Preview (first {uploadPreview.sample.length}):</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                          {uploadPreview.sample.map((n, i) => (
                            <span key={i} style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>{n}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Companies:</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {COMPANY_LIST.map(c => (
                        <button key={c} className={`company-toggle-btn ${uploadCompanies.includes(c) ? 'selected' : ''}`}
                          style={uploadCompanies.includes(c) ? { backgroundColor: COMPANY_COLORS[c], color: '#fff', borderColor: COMPANY_COLORS[c] } : { borderColor: COMPANY_COLORS[c], color: COMPANY_COLORS[c] }}
                          onClick={() => setUploadCompanies(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}>
                          {uploadCompanies.includes(c) ? '✓ ' : ''}{c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Category:</p>
                    <select className="filter-select" value={uploadCategory} onChange={e => { setUploadCategory(e.target.value); setUploadSubCategory(''); fetchSubCategories(e.target.value, setAvailableSubCategories); }} style={{ width: '150px' }}>
                      <option value="">Select...</option>
                      {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Sub-category:</p>
                    <select className="filter-select" value={uploadSubCategory} onChange={e => setUploadSubCategory(e.target.value)} disabled={!uploadCategory} style={{ width: '150px' }}>
                      <option value="">Select...</option>
                      {availableSubCategories.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <button className="btn btn-primary" onClick={handleExcelUpload} disabled={!uploadFile || uploadCompanies.length === 0 || senderLoading} style={{ alignSelf: 'flex-start' }}>
                  {senderLoading ? 'Uploading...' : 'Upload & Save'}
                </button>
              </div>
            </div>

            {/* ========== ADD SINGLE SENDER ========== */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 1rem 0', fontSize: '1.05rem' }}>
                <User size={18} /> Add Single Sender
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <input type="text" placeholder="Sender name or email address" className="search-input" value={newSenderName} onChange={(e) => setNewSenderName(e.target.value)} style={{ padding: '0.5rem 0.75rem', width: '100%', maxWidth: '400px' }} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginRight: '0.5rem' }}>Company:</span>
                  {COMPANY_LIST.map(c => (
                    <button key={c} className={`company-toggle-btn ${newSenderCompanies.includes(c) ? 'selected' : ''}`}
                      style={newSenderCompanies.includes(c) ? { backgroundColor: COMPANY_COLORS[c], color: '#fff', borderColor: COMPANY_COLORS[c] } : { borderColor: COMPANY_COLORS[c], color: COMPANY_COLORS[c] }}
                      onClick={() => setNewSenderCompanies(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}>
                      {newSenderCompanies.includes(c) ? '✓ ' : ''}{c}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Category:</span>
                    <select className="filter-select" value={newSenderCategory} onChange={e => { setNewSenderCategory(e.target.value); setNewSenderSubCategory(''); fetchSubCategories(e.target.value, setAvailableSubCategories); }} style={{ width: '160px', marginLeft: '0.5rem' }}>
                      <option value="">Select...</option>
                      {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sub-category:</span>
                    <select className="filter-select" value={newSenderSubCategory} onChange={e => setNewSenderSubCategory(e.target.value)} disabled={!newSenderCategory} style={{ width: '160px', marginLeft: '0.5rem' }}>
                      <option value="">Select...</option>
                      {availableSubCategories.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <button className="btn btn-primary" onClick={handleAddSenderMapping} disabled={!newSenderName.trim() || newSenderCompanies.length === 0 || senderLoading} style={{ alignSelf: 'flex-start' }}>
                  Save
                </button>
              </div>
            </div>

            {/* ========== SENDER MAPPINGS TABLE ========== */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Building2 size={18} /> Sender Mappings
                  <span className="badge badge-info" style={{ fontSize: '0.75rem' }}>{senderMappings.length}</span>
                </h3>
                <div className="search-wrapper" style={{ width: '250px' }}>
                  <Search className="search-icon" />
                  <input type="text" placeholder="Search senders..." className="search-input" value={senderSearch} onChange={(e) => setSenderSearch(e.target.value)} />
                </div>
              </div>
              {senderMappings.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No mappings yet. Upload an Excel file or add manually.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="mappings-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Sender</th>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Company</th>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Category</th>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Sub-category</th>
                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem' }}>Resolved Codeword</th>
                        <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {senderMappings.map(m => {
                        const resolvedCw = codewordsList.find(cw =>
                          cw.company === (m.companies?.[0] || '') &&
                          cw.category === (m.category || '') &&
                          cw.sub_category === (m.sub_category || '')
                        );
                        return (
                          <tr key={m.id}>
                            <td style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: 'var(--text-main)' }}>{m.sender_name}</td>
                            <td style={{ padding: '0.4rem 0.75rem' }}>
                              <div className="company-badge-list">
                                {(m.companies || []).map((c, idx) => (
                                  <React.Fragment key={idx}>
                                    {renderCustomBadge('company', c, COMPANY_COLORS[c])}
                                  </React.Fragment>
                                ))}
                              </div>
                            </td>
                            <td style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{m.category || '-'}</td>
                            <td style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{m.sub_category || '-'}</td>
                            <td style={{ padding: '0.4rem 0.75rem' }}>
                              {resolvedCw ? (
                                renderCustomBadge('codeword', resolvedCw.codeword, COMPANY_COLORS[resolvedCw.company])
                              ) : (
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>-</span>
                              )}
                            </td>
                            <td style={{ padding: '0.4rem 0.75rem', textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                                <button className="btn btn-small btn-secondary" onClick={() => { setEditMappingId(m.id); setEditMappingName(m.sender_name); setEditMappingCompanies(m.companies || []); setNewSenderCategory(m.category || ''); setNewSenderSubCategory(m.sub_category || ''); if (m.category) fetchSubCategories(m.category, setEditAvailableSubCategories); }} title="Edit">
                                  <Edit3 size={12} />
                                </button>
                                <button className="btn btn-small btn-danger" onClick={() => { if (confirm(`Delete mapping for "${m.sender_name}"?`)) handleDeleteSenderMapping(m.id); }} title="Delete">
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Edit Modal */}
            {editMappingId && (
              <div className="modal-overlay" onClick={() => { setEditMappingId(null); setEditMappingCompanies([]); }}>
                <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
                  <div className="modal-header">
                    <h3>Edit Mapping: {editMappingName}</h3>
                    <button className="btn-close" onClick={() => { setEditMappingId(null); setEditMappingCompanies([]); }}>&times;</button>
                  </div>
                  <div className="modal-body">
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Select companies:</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
                      {COMPANY_LIST.map(c => (
                        <button key={c} className={`company-toggle-btn ${editMappingCompanies.includes(c) ? 'selected' : ''}`}
                          style={editMappingCompanies.includes(c) ? { backgroundColor: COMPANY_COLORS[c], color: '#fff', borderColor: COMPANY_COLORS[c] } : { borderColor: COMPANY_COLORS[c], color: COMPANY_COLORS[c] }}
                          onClick={() => setEditMappingCompanies(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}>
                          {editMappingCompanies.includes(c) ? '✓ ' : ''}{c}
                        </button>
                      ))}
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Category / Sub-category:</p>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <select className="filter-select" value={newSenderCategory} onChange={e => { setNewSenderCategory(e.target.value); setNewSenderSubCategory(''); fetchSubCategories(e.target.value, setEditAvailableSubCategories); }} style={{ width: '160px' }}>
                        <option value="">Select...</option>
                        {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select className="filter-select" value={newSenderSubCategory} onChange={e => setNewSenderSubCategory(e.target.value)} disabled={!newSenderCategory} style={{ width: '160px' }}>
                        <option value="">Select...</option>
                        {editAvailableSubCategories.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={() => { setEditMappingId(null); setEditMappingCompanies([]); }}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleUpdateSenderMapping} disabled={editMappingCompanies.length === 0}>Save Changes</button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* AI KNOWLEDGE BASE / RULES TAB */}
        {activeTab === 'rules' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Chatbot style guide */}
            <div className="card" style={{ padding: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-start', borderLeft: '4px solid #7c3aed' }}>
              <div 
                style={{ 
                  width: '40px', 
                  height: '40px', 
                  borderRadius: '50%', 
                  backgroundColor: 'rgba(124, 58, 237, 0.1)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  color: '#7c3aed',
                  flexShrink: 0
                }}
              >
                <ShieldAlert size={20} />
              </div>
              <div>
                <h4 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '0.25rem', marginTop: 0 }}>AI Tender Assistant Guidelines</h4>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.4', margin: 0 }}>
                  Tell me how to identify incorrect email matches. For example, if you notice internal report emails, payment advices, or logs are matching by mistake, add a rule explaining why they should be ignored. I will immediately use these guidelines to filter them out during the next sync run!
                </p>
              </div>
            </div>

            {/* Rule Addition Form */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1.1rem', color: 'var(--text-main)', marginBottom: '1rem', marginTop: 0 }}>Teach the AI Matcher</h3>
              <form onSubmit={handleAddRule} style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
                <input
                  type="text"
                  placeholder="Enter rule (e.g., 'Do not match emails about payment advices or MC & IC report logs')"
                  value={newRuleText}
                  onChange={(e) => setNewRuleText(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                />
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  style={{
                    padding: '0.75rem 1.5rem',
                    borderRadius: '8px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Add Guideline
                </button>
              </form>
            </div>

            {/* List of active rules */}
            <div className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1.1rem', color: 'var(--text-main)', marginBottom: '1rem', marginTop: 0 }}>Active AI Guidelines</h3>
              {matchingRules.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>No custom guidelines configured. Add one above to get started!</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {matchingRules.map((rule) => (
                    <div 
                      key={rule.id} 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '1rem', 
                        backgroundColor: 'rgba(255, 255, 255, 0.02)', 
                        border: '1px solid var(--border-color)', 
                        borderRadius: '8px',
                        gap: '1rem'
                      }}
                    >
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                        <span style={{ color: '#7c3aed', fontWeight: 'bold', fontSize: '0.9rem' }}>•</span>
                        <span style={{ color: 'var(--text-main)', fontSize: '0.9rem', lineHeight: '1.4' }}>{rule.rule}</span>
                      </div>
                      <button 
                        onClick={() => handleDeleteRule(rule.id)}
                        className="btn"
                        style={{
                          padding: '0.35rem 0.75rem',
                          fontSize: '0.78rem',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          color: '#ef4444',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          borderRadius: '6px',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Remap and Cleanup Matches Action */}
            <div className="card" style={{ padding: '1.5rem', marginTop: '1.5rem', background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.03) 0%, rgba(236, 72, 153, 0.03) 100%)', border: '1px solid rgba(124, 58, 237, 0.15)' }}>
              <h3 style={{ fontSize: '1.1rem', color: 'var(--text-main)', marginBottom: '0.5rem', marginTop: 0 }}>Apply Rules and Remap Emails</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.4', marginBottom: '1.25rem', marginTop: 0 }}>
                Remap and re-verify all current matched emails in the system. The AI will scan your active matched emails against your new matching guidelines, and instantly delete any identified mismatches from the database.
              </p>
              <button
                className="btn btn-primary"
                onClick={handleRemapEmails}
                disabled={remapping}
                style={{
                  padding: '0.75rem 2rem',
                  borderRadius: '8px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                {remapping ? (
                  <>
                    <div className="spinner" style={{ width: '16px', height: '16px', border: '2px solid #fff', borderTop: '2px solid transparent', marginRight: '0.5rem', display: 'inline-block' }}></div>
                    Remapping Emails...
                  </>
                ) : (
                  <>
                    Remap & Clean Up Matches
                  </>
                )}
              </button>

              {remapResult && (
                <div style={{ marginTop: '1.25rem', padding: '1rem', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', color: '#10b981', fontSize: '0.9rem' }}>
                  <strong>Remapping Complete!</strong> Checked {remapResult.totalChecked} matches and removed <strong>{remapResult.totalDeleted} wrong email matches</strong> from your database!
                  {remapResult.deletedMatches?.length > 0 && (
                    <div style={{ marginTop: '0.75rem', maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {remapResult.deletedMatches.map((dm, idx) => (
                        <div key={idx} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.4rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                          🗑️ <strong>Tender:</strong> {dm.docketNo} — <strong>Subject:</strong> {dm.subject} <br/>
                          <span style={{ color: '#ef4444' }}>Reason: {dm.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 4. MATCHED EMAILS TAB */}
        {activeTab === 'emails' && (
          <div>
            {/* Search & Filter Bar for Matched Emails */}
            <div 
              style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                gap: '1rem', 
                flexWrap: 'wrap',
                marginBottom: '1rem',
                padding: '1rem',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                {/* Search Input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>Search:</span>
                  <input
                    type="text"
                    placeholder="Search subject, sender, token..."
                    className="search-input"
                    style={{ 
                      padding: '0.45rem 1rem', 
                      background: 'rgba(255,255,255,0.03)', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      width: '250px'
                    }}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                {/* Date Filters */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>Date:</span>
                  <input
                    type="date"
                    className="search-input"
                    style={{ width: '135px', padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
                    value={recStartDate}
                    onChange={(e) => setRecStartDate(e.target.value)}
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>to</span>
                  <input
                    type="date"
                    className="search-input"
                    style={{ width: '135px', padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
                    value={recEndDate}
                    onChange={(e) => setRecEndDate(e.target.value)}
                  />
                </div>

                {/* Clear Button */}
                {(searchQuery || recStartDate || recEndDate || subStartDate || subEndDate) && (
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem', borderRadius: '8px' }}
                    onClick={() => {
                      setSearchQuery('');
                      setRecStartDate('');
                      setRecEndDate('');
                      setSubStartDate('');
                      setSubEndDate('');
                    }}
                  >
                    Clear Filters
                  </button>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-main)', cursor: 'pointer', userSelect: 'none', marginLeft: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={showOnlyParticipatedIds}
                    onChange={(e) => {
                      setShowOnlyParticipatedIds(e.target.checked);
                      setMatchedEmailsPage(1);
                    }}
                  />
                  <span>Show Participated IDs Only</span>
                </label>
              </div>

              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span>Showing <strong>{filteredEmails.length}</strong> of <strong>{matchedEmailsTotal || emailsList.length}</strong> matched emails</span>
                {matchedEmailsTotal > matchedEmailsLimit && (
                  <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                    <button className="btn btn-small" disabled={matchedEmailsPage <= 1}
                      onClick={() => setMatchedEmailsPage(p => Math.max(1, p - 1))}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}>Prev</button>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Page {matchedEmailsPage}</span>
                    <button className="btn btn-small" disabled={matchedEmailsPage * matchedEmailsLimit >= matchedEmailsTotal}
                      onClick={() => setMatchedEmailsPage(p => p + 1)}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}>Next</button>
                  </div>
                )}
              </div>
            </div>

            {emailsLoading && emailsList.length === 0 ? (
              <div className="loading-container">
                <div className="spinner"></div>
                <p>Loading Matched Emails from Database...</p>
              </div>
            ) : filteredEmails.length === 0 ? (
              <div className="empty-state">
                <Mail size={40} />
                <h3>No Matched Emails Found</h3>
                <p>Try clearing your search query or sync the portal.</p>
              </div>
            ) : (
              <div className="table-container" style={{ opacity: emailsLoading ? 0.75 : 1, transition: 'opacity 0.2s' }}>
                <table className="tenders-table">
                  <thead>
                    <tr>
                      <th style={{ whiteSpace: 'nowrap', color: 'var(--color-primary-light)' }}>
                        <button
                          className="sort-th-btn"
                          onClick={() => setDateSortOrder(o => o === 'asc' ? 'desc' : 'asc')}
                          title={dateSortOrder === 'asc' ? 'Oldest first — click for Newest' : 'Newest first — click for Oldest'}
                        >
                          Date Received
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '1.35rem',
                            height: '1.35rem',
                            borderRadius: '4px',
                            background: 'rgba(99,102,241,0.18)',
                            border: '1px solid rgba(99,102,241,0.35)',
                            fontSize: '0.8rem',
                            fontWeight: 800,
                            color: '#818cf8',
                            marginLeft: '0.25rem',
                            transition: 'all 0.2s ease'
                          }}>{dateSortOrder === 'asc' ? '↑' : '↓'}</span>
                        </button>
                      </th>
                      <th>Subject</th>
                      <th>Sender</th>
                      <th>All Recipients</th>
                      <th>Matched Tender Details</th>
                      <th>Confidence</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmails.map(email => {
                      const parentTender = tenderMap.get(`${email.docket_no}|${email.tender_no}`);
                      const tenderLabel = parentTender 
                        ? `${parentTender.client} - ${parentTender.tenderFor || 'Tender'}`
                        : `Ref: ${email.docket_no || 'Manual/Participated'} | Tender ID: ${email.tender_no || 'N/A'}`;

                      return (
                        <tr key={`${email.id}-${email.docket_no || ''}-${email.tender_no || ''}-${email.matchedToken || email.matched_token || ''}`} onClick={() => openMatchChat(email)} style={{ cursor: 'pointer' }} className="row-interactive">
                          <td style={{ fontWeight: 600 }}>{formatDateTime(email.date_received)}</td>
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{email.subject}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '350px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {email.body ? email.body.replace(/<[^>]*>/g, '').substring(0, 80) + '...' : ''}
                            </div>
                          </td>
                          <td>
                            <div style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)' }}>{email.sender}</div>
                            {email.to_details && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={email.to_details}>
                                <span style={{ fontWeight: 600 }}>Receiver: </span>{email.to_details}
                              </div>
                            )}
                            {email.cc_details && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={email.cc_details}>
                                <span style={{ fontWeight: 600 }}>CC: </span>{email.cc_details}
                              </div>
                            )}
                            <div className="company-badge-list" style={{ marginTop: '0.2rem' }}>
                              {renderSenderBadges(email).map((b, i) => (
                                <React.Fragment key={i}>
                                  {renderCustomBadge(b.type, b.label, b.color)}
                                </React.Fragment>
                              ))}
                            </div>
                          </td>
                          <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={mergeEmailLists(email.to_details, email.cc_details)}>
                            {mergeEmailLists(email.to_details, email.cc_details) || '—'}
                          </td>
                          <td style={{ fontSize: '0.9rem', color: 'var(--text-main)', maxWidth: '280px', wordBreak: 'break-word' }}>
                            <div style={{ fontWeight: 600 }}>{tenderLabel}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {email.matchedToken ? `Matched Token: ${email.matchedToken}` : 'No tender match details available.'}
                            </div>
                          </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`badge ${email.confidence === 'HIGH' ? 'badge-success' : 'badge-warning'}`}>
                            {email.confidence || 'UNKNOWN'} Confidence
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-secondary btn-small"
                            onClick={e => {
                              e.stopPropagation();
                              openMatchChat(email);
                            }}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 5. ALL EMAILS EXPLORER TAB */}
        {activeTab === 'all-emails' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Category & Sub-Category Filter Bars */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
              padding: '0.75rem 1.25rem',
              background: 'rgba(255,255,255,0.02)',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {/* Category row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                  fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  whiteSpace: 'nowrap', paddingRight: '0.6rem',
                  borderRight: '1px solid rgba(255,255,255,0.1)',
                  minWidth: '90px'
                }}>
                  <Grid size={12} /> Category
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
                  {availableCategories.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Loading categories from database...</span>
                  ) : (
                    [{ key: '', label: 'All' }, ...availableCategories.map(c => ({ key: c, label: c }))].map(cat => {
                    const color = cat.key ? (CATEGORY_COLORS[cat.key] || '#818cf8') : null;
                    const isActive = cat.key === '' ? selectedCategoryFilter === '' : selectedCategoryFilter === cat.key;
                    const btnStyle = cat.key
                      ? isActive
                        ? { backgroundColor: color, borderColor: color, color: '#ffffff' }
                        : { backgroundColor: `${color}18`, borderColor: `${color}50`, color: color }
                      : isActive
                        ? { backgroundColor: 'var(--color-primary, #6366f1)', borderColor: 'var(--color-primary, #6366f1)', color: '#ffffff' }
                        : { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.15)', color: 'var(--text-muted)' };
                    return (
                      <button
                        key={cat.key || 'all'}
                        className={`company-filter-btn ${isActive ? 'active' : ''}`}
                        style={btnStyle}
                        onClick={() => setSelectedCategoryFilter(cat.key === '' ? '' : (isActive ? '' : cat.key))}
                      >
                        {cat.label}
                      </button>
                    );
                  })
                  )}
                </div>
              </div>

              {/* Sub-Category row — shown when category selected and subcategories exist */}
              {selectedCategoryFilter && explorerSubCategories.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.5rem' }}>
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                    fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.1em',
                    whiteSpace: 'nowrap', paddingRight: '0.6rem',
                    borderRight: '1px solid rgba(255,255,255,0.1)',
                    minWidth: '90px'
                  }}>
                    <Layers size={12} /> Sub-Cat
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
                    {['', ...explorerSubCategories].map(sub => {
                      const baseColor = CATEGORY_COLORS[selectedCategoryFilter];
                      const isActive = selectedSubCategoryFilter === sub;
                      const btnStyle = sub
                        ? isActive
                          ? { backgroundColor: baseColor, borderColor: baseColor, color: '#ffffff' }
                          : { backgroundColor: `${baseColor}15`, borderColor: `${baseColor}40`, color: baseColor }
                        : isActive
                          ? { backgroundColor: 'var(--color-primary, #6366f1)', borderColor: 'var(--color-primary, #6366f1)', color: '#ffffff' }
                          : { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.15)', color: 'var(--text-muted)' };
                      return (
                        <button
                          key={sub || 'all'}
                          className={`company-filter-btn ${isActive ? 'active' : ''}`}
                          style={btnStyle}
                          onClick={() => setSelectedSubCategoryFilter(isActive ? '' : sub)}
                        >
                          {sub || 'All'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Custom Label Filter Pills (Horizontal Scrollable) */}
            {availableLabels.length > 0 && (
              <div 
                style={{ 
                  display: 'flex', 
                  gap: '0.5rem', 
                  overflowX: 'auto', 
                  paddingBottom: '0.75rem',
                  scrollbarWidth: 'thin',
                  borderBottom: '1px solid var(--border-color)',
                  alignItems: 'center'
                }}
              >
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '600', marginRight: '0.25rem', whiteSpace: 'nowrap' }}>Labels:</span>
                <button
                  className={`btn ${selectedLabelFilter === '' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ 
                    padding: '0.4rem 0.9rem', 
                    borderRadius: '20px', 
                    fontSize: '0.8rem',
                    whiteSpace: 'nowrap',
                    flexShrink: 0
                  }}
                  onClick={() => setSelectedLabelFilter('')}
                >
                  All Labels
                </button>
                {availableLabels.map(lbl => (
                  <button
                    key={lbl}
                    className={`btn ${selectedLabelFilter === lbl ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ 
                      padding: '0.4rem 0.9rem', 
                      borderRadius: '20px', 
                      fontSize: '0.8rem',
                      whiteSpace: 'nowrap',
                      flexShrink: 0
                    }}
                    onClick={() => setSelectedLabelFilter(lbl)}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}

            {/* Explorer Sub-filters Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>

                {/* Local Search inside All Emails */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Search:</span>
                  <input
                    type="text"
                    placeholder="Search subject, body, OCR..."
                    className="search-input"
                    style={{ 
                      padding: '0.45rem 1rem', 
                      background: 'rgba(255,255,255,0.03)', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      width: '220px'
                    }}
                    value={allEmailsSearch}
                    onChange={(e) => setAllEmailsSearch(e.target.value)}
                  />
                  {allEmailsSearch && (
                    <button 
                      className="btn-clear" 
                      onClick={() => setAllEmailsSearch('')}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: '-1.75rem', zIndex: 5 }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Recipient Search inside All Emails */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Recipient:</span>
                  <input
                    type="text"
                    placeholder="Recipient email..."
                    className="search-input"
                    style={{ 
                      padding: '0.45rem 1rem', 
                      background: 'rgba(255,255,255,0.03)', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      width: '220px'
                    }}
                    value={recipientSearch}
                    onChange={(e) => setRecipientSearch(e.target.value)}
                  />
                  {recipientSearch && (
                    <button 
                      className="btn-clear" 
                      onClick={() => setRecipientSearch('')}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: '-1.75rem', zIndex: 5 }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Urgent Sales/Legal Only Toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', userSelect: 'none', color: 'var(--text-muted)' }}>
                  <input
                    type="checkbox"
                    checked={urgentOnly}
                    onChange={(e) => setUrgentOnly(e.target.checked)}
                  />
                  Urgent - Sales/Legal Only
                </label>
              </div>

              {/* Total items count & Pagination info */}
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Showing <strong>{allEmails.length}</strong> of <strong>{allEmailsTotal}</strong> emails
              </div>
            </div>

            {/* Emails Table */}
            {allEmailsLoading && allEmails.length === 0 ? (
              <div className="loading-container">
                <div className="spinner"></div>
                <p>Loading Emails Explorer...</p>
              </div>
            ) : allEmails.length === 0 ? (
              <div className="empty-state">
                <Mail size={40} />
                <h3>No Emails Found</h3>
                <p>No emails match your selected filters. Try clearing your search or category toggles.</p>
              </div>
            ) : (
              <div className="table-container" style={{ opacity: allEmailsLoading ? 0.75 : 1, transition: 'opacity 0.2s' }}>
                <table className="tenders-table">
                  <thead>
                    <tr>
                      <th style={{ width: '160px', whiteSpace: 'nowrap', color: 'var(--color-primary-light)' }}>
                        <button
                          className="sort-th-btn"
                          onClick={() => setDateSortOrder(o => o === 'asc' ? 'desc' : 'asc')}
                          title={dateSortOrder === 'asc' ? 'Oldest first — click for Newest' : 'Newest first — click for Oldest'}
                        >
                          Date Received
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '1.35rem',
                            height: '1.35rem',
                            borderRadius: '4px',
                            background: 'rgba(99,102,241,0.18)',
                            border: '1px solid rgba(99,102,241,0.35)',
                            fontSize: '0.8rem',
                            fontWeight: 800,
                            color: '#818cf8',
                            marginLeft: '0.25rem',
                            transition: 'all 0.2s ease'
                          }}>{dateSortOrder === 'asc' ? '↑' : '↓'}</span>
                        </button>
                      </th>
                      <th>Subject & Preview</th>
                      <th style={{ width: '220px' }}>Sender</th>
                      <th style={{ width: '220px' }}>All Recipients</th>
                      <th style={{ width: '150px' }}>Category</th>
                      <th style={{ width: '200px' }}>Custom Labels</th>
                      <th style={{ width: '100px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allEmails.map(email => (
                      <tr 
                        key={email.id} 
                        onClick={() => handleOpenEmailDetail(email.id)} 
                        style={{ cursor: 'pointer' }} 
                        className="row-interactive"
                      >
                        <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                          {formatDateTime(email.date || email.date_received)}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {email.is_important === 1 && (
                              <span 
                                className="badge badge-danger" 
                                style={{ 
                                  fontSize: '0.65rem', 
                                  padding: '0.1rem 0.3rem', 
                                  borderRadius: '4px',
                                  backgroundColor: 'var(--color-danger)'
                                }}
                              >
                                Important
                              </span>
                            )}
                            {email.reply_required === 1 && (
                              <span 
                                className="badge badge-danger" 
                                style={{ 
                                  fontSize: '0.65rem', 
                                  padding: '0.1rem 0.3rem', 
                                  borderRadius: '4px',
                                  backgroundColor: '#ef4444'
                                }}
                                title={email.reply_reason || 'Urgent reply required'}
                              >
                                Urgent Reply
                              </span>
                            )}
                            {email.subject}
                          </div>
                          <div 
                            style={{ 
                              fontSize: '0.75rem', 
                              color: 'var(--text-muted)', 
                              maxWidth: '450px', 
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis', 
                              whiteSpace: 'nowrap',
                              marginTop: '0.2rem'
                            }}
                          >
                            {email.body_preview}
                          </div>
                        </td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-main)', maxWidth: '220px', overflow: 'hidden' }} title={email.sender}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{email.sender}</div>
                          {email.to_details && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={email.to_details}>
                              <span style={{ fontWeight: 600 }}>Receiver: </span>{email.to_details}
                            </div>
                          )}
                          {email.cc_details && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={email.cc_details}>
                              <span style={{ fontWeight: 600 }}>CC: </span>{email.cc_details}
                            </div>
                          )}
                          <div className="company-badge-list" style={{ marginTop: '0.15rem' }}>
                            {renderSenderBadges(email).map((b, i) => (
                              <React.Fragment key={i}>
                                {renderCustomBadge(b.type, b.label, b.color)}
                              </React.Fragment>
                            ))}
                          </div>
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={mergeEmailLists(email.to_details, email.cc_details)}>
                          {mergeEmailLists(email.to_details, email.cc_details) || '—'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', alignItems: 'flex-start' }}>
                            <span 
                              className={`badge ${
                                email.category?.toLowerCase().includes('finance') || email.category?.toLowerCase().includes('banking') ? 'badge-success' :
                                email.category?.toLowerCase().includes('legal') ? 'badge-danger' :
                                email.category?.toLowerCase().includes('sales') ? 'badge-warning' :
                                email.category?.toLowerCase().includes('purchase') ? 'badge-info' :
                                email.category?.toLowerCase().includes('hr') ? 'badge-secondary' :
                                email.category?.toLowerCase().includes('promotion') ? 'badge-muted' :
                                'badge-muted'
                              }`}
                            >
                              {email.category || 'General'}
                            </span>
                            {email.sub_category && (
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', paddingLeft: '0.25rem' }}>
                                {email.sub_category}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }} onClick={(e) => e.stopPropagation()}>
                            {email.user_labels ? (
                              email.user_labels.split(',').map(lbl => {
                                const label = lbl.trim();
                                if (!label) return null;
                                return (
                                  <span 
                                    key={label} 
                                    className="badge badge-success"
                                    style={{ 
                                      fontSize: '0.7rem', 
                                      padding: '0.15rem 0.4rem', 
                                      borderRadius: '4px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.2'
                                    }}
                                  >
                                    {label}
                                    <span 
                                      style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '0.65rem' }} 
                                      onClick={() => handleRemoveLabel(email, label)}
                                    >
                                      ✕
                                    </span>
                                  </span>
                                );
                              })
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontStyle: 'italic' }}>-</span>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                            {email.reply_required === 1 && (
                              <>
                                <button
                                  className="btn btn-primary btn-small"
                                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                                  onClick={() => handleOpenEmailReplyModal(email)}
                                  title={email.reply_reason || 'Generate reply to this email'}
                                >
                                  <Send size={11} />
                                  Reply
                                </button>
                                
                                <button
                                  className="btn btn-small"
                                  style={{ 
                                    padding: '0.3rem 0.6rem', 
                                    fontSize: '0.78rem',
                                    backgroundColor: '#7c3aed',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.2rem',
                                    cursor: 'pointer',
                                    opacity: quickReplyLoading[email.id] ? 0.7 : 1
                                  }}
                                  onClick={() => handleQuickAutoReplyForEmail(email)}
                                  disabled={quickReplyLoading[email.id]}
                                  title="Generate suggested reply and send it immediately using AI"
                                >
                                  {quickReplyLoading[email.id] ? (
                                    <span className="spinner-mini" style={{ width: '10px', height: '10px', border: '2px solid white', borderTop: '2px solid transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 1s linear infinite' }}></span>
                                  ) : (
                                    <Zap size={11} />
                                  )}
                                  {quickReplyLoading[email.id] ? 'Sending...' : 'AI Auto-Send'}
                                </button>
                              </>
                            )}
                            <button
                              className="btn btn-secondary btn-small"
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }}
                              onClick={() => handleOpenEmailDetail(email.id)}
                            >
                              Inspect
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Footer */}
            {allEmailsTotal > 0 && (
              <div 
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  padding: '1rem', 
                  backgroundColor: 'var(--bg-card)', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: '12px',
                  marginTop: '1rem',
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                  flexWrap: 'wrap',
                  gap: '1rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>Show</span>
                  <select
                    className="search-input"
                    style={{ 
                      padding: '0.25rem 0.5rem', 
                      background: 'rgba(255,255,255,0.03)', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: '6px',
                      fontSize: '0.85rem'
                    }}
                    value={allEmailsLimit}
                    onChange={(e) => {
                      setAllEmailsLimit(Number(e.target.value));
                      setAllEmailsPage(1);
                    }}
                  >
                    {[10, 20, 50, 100].map(val => (
                      <option key={val} value={val} style={{ backgroundColor: 'var(--bg-main)' }}>{val}</option>
                    ))}
                  </select>
                  <span>emails per page</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                    disabled={allEmailsPage === 1 || allEmailsLoading}
                    onClick={() => setAllEmailsPage(prev => Math.max(prev - 1, 1))}
                  >
                    Previous
                  </button>
                  <span>
                    Page <strong>{allEmailsPage}</strong> of <strong>{Math.ceil(allEmailsTotal / allEmailsLimit) || 1}</strong>
                  </span>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                    disabled={allEmailsPage >= Math.ceil(allEmailsTotal / allEmailsLimit) || allEmailsLoading}
                    onClick={() => setAllEmailsPage(prev => prev + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* TENDER INSPECT MODAL */}
      {selectedTender && (
        <div className="modal-backdrop" onClick={() => setSelectedTender(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px' }}>
            <div className="modal-header">
              <div>
                <h2>{selectedTender.tenderFor || 'Tender Item'}</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Date: {selectedTender.docketNo || 'N/A'} | Client: {selectedTender.client}</div>
              </div>
              <button className="modal-close" onClick={() => setSelectedTender(null)}>✕</button>
            </div>

            <div className="modal-body">
              {/* Tender Details Info Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                <div><strong>Tender No Raw:</strong> <span style={{ color: 'var(--color-secondary)' }}>{selectedTender.tenderNoRaw}</span></div>
                <div><strong>Submission Deadline:</strong> {selectedTender.lastDate || 'N/A'}</div>
                <div><strong>Extracted Deadline:</strong> <span style={{ color: selectedTender.deadlineDate && !isSentinelDate(selectedTender.deadlineDate) && isDeadlinePastOrToday(selectedTender.deadlineDate) ? 'var(--color-danger)' : 'inherit' }}>{selectedTender.deadlineDate && !isSentinelDate(selectedTender.deadlineDate) ? formatDateTime(selectedTender.deadlineDate) : 'N/A'}</span></div>
                <div><strong>Opening Date:</strong> {selectedTender.openingDate || 'N/A'}</div>
                <div><strong>Estimated Cost:</strong> {selectedTender.estimatedCost || 'N/A'}</div>
                <div><strong>EMD Amount:</strong> {selectedTender.emd || 'N/A'}</div>
                <div><strong>Current Status:</strong> <span className="badge badge-info">{selectedTender.status || 'Active'}</span></div>
                <div><strong>Remarks:</strong> {selectedTender.remarks || 'None'}</div>
                <div><strong>Prepared By:</strong> {selectedTender.prepareBy || 'N/A'}</div>
              </div>

              {/* Matched Emails section */}
              <div>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Mail size={16} />
                  Matched Emails {modalStartDate || modalEndDate ? `(${filteredTenderEmails.length} of ${tenderEmails.length})` : `(${tenderEmails.length})`}
                </h3>

                {tenderEmails.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.01)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Filter by Date:</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <input
                        type="date"
                        className="search-input"
                        style={{ width: '135px', padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
                        value={modalStartDate}
                        onChange={(e) => setModalStartDate(e.target.value)}
                      />
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>to</span>
                      <input
                        type="date"
                        className="search-input"
                        style={{ width: '135px', padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
                        value={modalEndDate}
                        onChange={(e) => setModalEndDate(e.target.value)}
                      />
                    </div>
                    {(modalStartDate || modalEndDate) && (
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', height: 'auto' }}
                        onClick={() => { setModalStartDate(''); setModalEndDate(''); }}
                      >
                        Clear
                      </button>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', cursor: 'pointer', userSelect: 'none', marginLeft: 'auto' }}>
                      <input
                        type="checkbox"
                        checked={excludeTenderTiger}
                        onChange={(e) => setExcludeTenderTiger(e.target.checked)}
                      />
                      Exclude @tendertiger.com
                    </label>
                  </div>
                )}

                {emailLoading ? (
                  <div className="loading-container"><div className="spinner"></div></div>
                ) : filteredTenderEmails.length === 0 ? (
                  <div className="empty-state" style={{ padding: '2.5rem' }}>
                    <AlertCircle size={30} />
                    <h3>No Matched Emails Found</h3>
                    <p>{modalStartDate || modalEndDate ? 'No emails match the selected date range.' : `No email matches the tender ID tokens: ${selectedTender.tokens?.join(', ') || 'N/A'}`}</p>
                  </div>
                ) : (
                  <div className="emails-list" style={{ maxHeight: '350px', overflowY: 'auto' }}>
                    {filteredTenderEmails.map(email => (
                      <div
                        key={`${email.id}-${email.docket_no || ''}-${email.tender_no || ''}-${email.matchedToken || email.matched_token || ''}`}
                        className="card card-interactive email-card"
                        onClick={() => openMatchChat(email)}
                      >
                        <div className="email-meta">
                            <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                Sender: {email.sender}
                                <div className="company-badge-list" style={{ display: 'inline-flex' }}>
                                  {renderSenderBadges(email).map((b, i) => (
                                    <React.Fragment key={i}>
                                      {renderCustomBadge(b.type, b.label, b.color)}
                                    </React.Fragment>
                                  ))}
                                </div>
                              </span>
                              {email.to_details && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  <strong>Receiver:</strong> {email.to_details}
                                </span>
                              )}
                              {email.cc_details && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  <strong>CC:</strong> {email.cc_details}
                              </span>
                            )}
                          </span>
                          <span>{formatDateTime(email.date_received)}</span>
                        </div>
                        <div className="email-subject">{email.subject}</div>
                        <div className="email-body-preview">{email.body.replace(/<[^>]*>/g, '')}</div>

                        {/* Summary box inside card */}
                        {email.summary ? (
                          <div className="email-summary" onClick={(e) => e.stopPropagation()} style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
                            <div className="email-summary-header">
                              <span>✨ AI Summary</span>
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem', height: 'auto', borderRadius: '4px' }}
                                onClick={(e) => { e.stopPropagation(); handleManualSummarize(email.id); }}
                                disabled={summarizing}
                              >
                                {summarizing ? '...' : 'Regenerate'}
                              </button>
                            </div>
                            <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.4', margin: 0, fontSize: '0.8rem' }}>{email.summary}</p>
                          </div>
                        ) : (
                          <div style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                              onClick={(e) => { e.stopPropagation(); handleManualSummarize(email.id); }}
                              disabled={summarizing}
                            >
                              ✨ Generate AI Summary
                            </button>
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-primary-light)' }}>
                            Matched Token: <strong>{email.matchedToken}</strong>
                          </span>
                          <span className={`badge ${email.confidence === 'HIGH' ? 'badge-success' : 'badge-warning'}`}>
                            {email.confidence} Confidence
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedTender(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* EMAIL DETAIL VIEW MODAL */}
      {selectedEmail && (
        <div 
          className="email-modal-overlay-root" 
          onClick={() => setSelectedEmail(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: '1.5rem',
            boxSizing: 'border-box'
          }}
        >
          <div 
            className="email-modal-card-light" 
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              width: '1280px',
              maxWidth: '95vw',
              height: '88vh',
              maxHeight: '90vh',
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '14px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              margin: 'auto',
              color: '#0f172a'
            }}
          >
            
            {/* FIXED LIGHT HEADER */}
            <div className="email-modal-header-light" style={{ padding: '1.1rem 1.5rem', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                    <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: '#0f172a', lineHeight: '1.35', wordBreak: 'break-word' }}>
                      {selectedEmail.subject || '(No Subject)'}
                    </h2>
                    {(selectedEmail.matchedToken || selectedEmail.matched_token) && (
                      <span style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', borderRadius: '6px', backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', fontWeight: 600 }}>
                        Token: {selectedEmail.matchedToken || selectedEmail.matched_token}
                      </span>
                    )}
                    {selectedEmail.confidence && (
                      <span style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', borderRadius: '6px', backgroundColor: selectedEmail.confidence === 'HIGH' ? '#eff6ff' : '#fffbeb', color: selectedEmail.confidence === 'HIGH' ? '#1d4ed8' : '#b45309', border: selectedEmail.confidence === 'HIGH' ? '1px solid #bfdbfe' : '1px solid #fde68a', fontWeight: 600 }}>
                        {selectedEmail.confidence} Confidence
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.82rem', color: '#64748b' }}>
                    {/* Sender Pill */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: '#ffffff', padding: '0.25rem 0.65rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                      <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#ffffff', fontWeight: 700, fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {(selectedEmail.sender || 'Sender').replace(/<.*?>/g, '').trim().slice(0, 2).toUpperCase()}
                      </div>
                      <span>From: <strong style={{ color: '#0f172a' }}>{selectedEmail.sender}</strong></span>
                    </div>

                    {/* Date Pill */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', backgroundColor: '#ffffff', padding: '0.25rem 0.65rem', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                      <Calendar size={13} color="#6366f1" />
                      <span>{formatDateTime(selectedEmail.date_received || selectedEmail.date)}</span>
                    </div>

                    {/* To Details */}
                    {selectedEmail.to_details && (
                      <div style={{ color: '#475569' }}>To: <span style={{ color: '#0f172a', fontWeight: 500 }}>{selectedEmail.to_details}</span></div>
                    )}

                    {/* CC Details with expand pill */}
                    {selectedEmail.cc_details && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <span>CC:</span>
                        {(() => {
                          const ccs = selectedEmail.cc_details.split(',').map(c => c.trim()).filter(Boolean);
                          if (ccs.length <= 2 || showFullCc) {
                            return (
                              <span style={{ color: '#0f172a', wordBreak: 'break-all' }}>
                                {ccs.join(', ')}
                                {ccs.length > 2 && (
                                  <button style={{ marginLeft: '0.4rem', padding: '0.1rem 0.4rem', fontSize: '0.68rem', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#475569', cursor: 'pointer' }} onClick={() => setShowFullCc(false)}>Hide</button>
                                )}
                              </span>
                            );
                          }
                          return (
                            <span>
                              <span style={{ color: '#0f172a' }}>{ccs.slice(0, 2).join(', ')}</span>
                              <button style={{ marginLeft: '0.35rem', padding: '0.1rem 0.45rem', fontSize: '0.68rem', borderRadius: '10px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#6366f1', fontWeight: 600, cursor: 'pointer' }} onClick={() => setShowFullCc(true)}>
                                + {ccs.length - 2} more
                              </button>
                            </span>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions & Close Button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                  <a
                    href={selectedEmail.thread_id ? `https://mail.google.com/mail/#all/${selectedEmail.thread_id}` : `https://mail.google.com/mail/#search/subject:"${encodeURIComponent((selectedEmail.subject || '').replace(/^(re|fwd):\s*/i, '').trim())}"`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.35rem 0.75rem',
                      backgroundColor: '#ea4335',
                      color: '#ffffff',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      borderRadius: '6px',
                      textDecoration: 'none',
                      boxShadow: '0 1px 3px rgba(234,67,53,0.3)',
                      transition: 'opacity 0.2s'
                    }}
                    title="Open this exact thread directly in Gmail"
                  >
                    <ExternalLink size={12} color="#ffffff" />
                    Open in Gmail
                  </a>

                  {selectedEmail.subject && (
                    <a
                      href={`https://mail.google.com/mail/#search/subject:"${encodeURIComponent(selectedEmail.subject.replace(/^(re|fwd):\s*/i, '').trim())}"`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        padding: '0.35rem 0.65rem',
                        backgroundColor: '#ffffff',
                        color: '#ea4335',
                        border: '1px solid #ea4335',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        borderRadius: '6px',
                        textDecoration: 'none',
                        transition: 'opacity 0.2s'
                      }}
                      title="Search by Email Subject in Gmail"
                    >
                      <Search size={12} color="#ea4335" />
                      Search Subject
                    </a>
                  )}

                  <button 
                    onClick={() => setSelectedEmail(null)} 
                    title="Close Email Viewer"
                    style={{ 
                      background: '#ffffff', 
                      border: '1px solid #cbd5e1', 
                      borderRadius: '50%', 
                      width: '34px', 
                      height: '34px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      color: '#64748b', 
                      cursor: 'pointer',
                      fontSize: '1rem',
                      fontWeight: 600,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            {/* 2-COLUMN MAIN BODY (SCROLLS INDEPENDENTLY) */}
            <div className="email-modal-body-row" style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              
              {/* LEFT COLUMN: EMAIL THREAD & OCR */}
              <div className="email-modal-left-pane-light" style={{ flex: '1 1 62%', minWidth: 0, padding: '1.1rem 1.4rem', overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: '0.9rem', borderRight: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                
                {/* ✨ AI Summary Card */}
                <div style={{ padding: '0.9rem 1.15rem', backgroundColor: '#faf5ff', borderRadius: '10px', border: '1px solid #e9d5ff', boxShadow: '0 1px 3px rgba(124, 58, 237, 0.05)' }}>
                  <div style={{ marginBottom: '0.45rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#7c3aed', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      ✨ AI Executive Summary
                    </span>
                    {selectedEmail.summary && (
                      <button
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', borderRadius: '6px', border: '1px solid #d8b4fe', backgroundColor: '#ffffff', color: '#7c3aed', cursor: 'pointer', fontWeight: 500 }}
                        onClick={() => handleManualSummarize(selectedEmail.id)}
                        disabled={summarizing}
                      >
                        {summarizing ? 'Regenerating...' : '🔄 Regenerate'}
                      </button>
                    )}
                  </div>
                  {selectedEmail.summary ? (
                    <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', margin: 0, fontSize: '0.88rem', color: '#334155' }}>{selectedEmail.summary}</p>
                  ) : (
                    <div>
                      <button
                        style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem', borderRadius: '6px', backgroundColor: '#7c3aed', color: '#ffffff', border: 'none', cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 4px rgba(124, 58, 237, 0.2)' }}
                        onClick={() => handleManualSummarize(selectedEmail.id)}
                        disabled={summarizing}
                      >
                        {summarizing ? 'Generating Summary...' : '✨ Generate AI Summary'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Custom Labels Section */}
                <div style={{ padding: '0.8rem 1rem', backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', marginBottom: '0.45rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <FileText size={13} color="#6366f1" />
                    Custom Labels
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.45rem' }}>
                    {selectedEmail.user_labels ? (
                      selectedEmail.user_labels.split(',').map(lbl => {
                        const label = lbl.trim();
                        if (!label) return null;
                        return (
                          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.55rem', fontSize: '0.75rem', borderRadius: '6px', backgroundColor: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', fontWeight: 500 }}>
                            {label}
                            <span style={{ cursor: 'pointer', fontWeight: 'bold', marginLeft: '0.2rem' }} onClick={() => handleRemoveLabel(selectedEmail, label)}>✕</span>
                          </span>
                        );
                      })
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontStyle: 'italic' }}>No custom labels assigned.</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {availableLabels.slice(0, 5).map(lbl => {
                      const existing = selectedEmail.user_labels ? selectedEmail.user_labels.split(',').map(x => x.trim().toLowerCase()) : [];
                      const isAssigned = existing.includes(lbl.toLowerCase());
                      return (
                        <button key={lbl} 
                          style={{ padding: '0.2rem 0.5rem', borderRadius: '12px', fontSize: '0.72rem', cursor: 'pointer', backgroundColor: isAssigned ? '#6366f1' : '#f1f5f9', color: isAssigned ? '#ffffff' : '#475569', border: '1px solid ' + (isAssigned ? '#6366f1' : '#cbd5e1'), fontWeight: 500 }}
                          onClick={() => isAssigned ? handleRemoveLabel(selectedEmail, lbl) : handleAddLabel(selectedEmail, lbl)}>
                          {isAssigned ? '✓' : '+'} {lbl}
                        </button>
                      );
                    })}
                    <input type="text" placeholder="Add label..." 
                      style={{ padding: '0.22rem 0.55rem', fontSize: '0.75rem', width: '115px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: '#0f172a', outline: 'none' }}
                      value={labelInput} onChange={(e) => setLabelInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { handleAddLabel(selectedEmail, labelInput); setLabelInput(''); } }} />
                  </div>
                </div>

                {/* PARSED EMAIL THREAD TIMELINE */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Mail size={14} color="#6366f1" />
                    Structured Email Thread Messages ({parseEmailThread(selectedEmail.body, selectedEmail.sender).length || 1})
                  </div>

                  {(() => {
                    const parsed = parseEmailThread(selectedEmail.body, selectedEmail.sender);
                    const messagesToRender = parsed.length > 0 ? parsed : [{ text: selectedEmail.body, sender: selectedEmail.sender, date: selectedEmail.date_received || selectedEmail.date }];

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative', paddingLeft: '1.25rem' }}>
                        {messagesToRender.length > 1 && (
                          <div style={{ position: 'absolute', left: '0.6rem', top: '1.2rem', bottom: '1.2rem', width: '2px', background: '#cbd5e1', zIndex: 1 }}></div>
                        )}

                        {messagesToRender.map((msg, idx) => {
                          const stepLabel = idx === 0 ? '📩 Latest Email' : (idx === messagesToRender.length - 1 ? '✉️ Original Inquiry' : `💬 Reply #${messagesToRender.length - idx}`);
                          const badgeBg = idx === 0 ? '#eff6ff' : '#f8fafc';
                          const badgeColor = idx === 0 ? '#1d4ed8' : '#475569';
                          const badgeBorder = idx === 0 ? '#bfdbfe' : '#cbd5e1';
                          const msgSender = msg.sender || msg.defaultSender || selectedEmail.sender;

                          return (
                            <div key={idx} style={{ position: 'relative', zIndex: 2, backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #cbd5e1', padding: '1.15rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.6rem', marginBottom: '0.75rem', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flex: 1, minWidth: 0 }}>
                                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: idx === 0 ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : '#cbd5e1', color: '#ffffff', fontWeight: 700, fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    {msgSender.replace(/<.*?>/g, '').trim().charAt(0).toUpperCase()}
                                  </div>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a' }}>{msgSender}</span>
                                      <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '4px', backgroundColor: badgeBg, color: badgeColor, border: `1px solid ${badgeBorder}`, fontWeight: 700 }}>
                                        {stepLabel}
                                      </span>
                                    </div>
                                    {msg.date && <div style={{ fontSize: '0.73rem', color: '#64748b', marginTop: '0.15rem' }}>📅 {msg.date}</div>}
                                  </div>
                                </div>
                              </div>

                              {(msg.subject || msg.to || msg.cc) && (
                                <div style={{ fontSize: '0.78rem', color: '#475569', backgroundColor: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0', marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                  {msg.subject && <div><strong style={{ color: '#0f172a' }}>Subject:</strong> {msg.subject}</div>}
                                  {msg.to && <div><strong style={{ color: '#0f172a' }}>To:</strong> {msg.to}</div>}
                                  {msg.cc && <div><strong style={{ color: '#0f172a' }}>Cc:</strong> {msg.cc}</div>}
                                </div>
                              )}

                              {(() => {
                                let rawMsgText = msg.body || msg.text || '';
                                let msgText = rawMsgText.replace(/^--- Message \d+ From:.*?---\s*/gi, '').trim();
                                msgText = msgText.replace(/(\r?\n){3,}/g, '\n\n');

                                const { css, cleanText } = extractCssFromText(msgText);
                                const lower = cleanText.toLowerCase();

                                const hasHtml = (
                                  lower.includes('<html') ||
                                  lower.includes('<div') ||
                                  lower.includes('<p') ||
                                  lower.includes('<span') ||
                                  lower.includes('<table') ||
                                  lower.includes('<body') ||
                                  lower.includes('<br') ||
                                  lower.includes('<a ') ||
                                  lower.includes('<!doctype html') ||
                                  /<[a-z][\s\S]*>/i.test(cleanText)
                                );

                                const hasCss = css.trim().length > 0;

                                if (hasHtml || hasCss) {
                                  const bodyContent = hasHtml ? cleanText : `<div style="white-space: pre-wrap; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6;">${cleanText}</div>`;
                                  return (
                                    <div style={{ border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                                      <iframe
                                        title={`Matched Message ${idx}`}
                                        srcDoc={`
                                          <!DOCTYPE html>
                                          <html>
                                            <head>
                                              <meta charset="utf-8">
                                              <style>
                                                body {
                                                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                                                  font-size: 14px;
                                                  line-height: 1.65;
                                                  color: #1e293b;
                                                  margin: 1.1rem;
                                                  word-wrap: break-word;
                                                }
                                                img { max-width: 100%; height: auto; }
                                                table { border-collapse: collapse; width: 100%; margin: 0.8rem 0; }
                                                th, td { border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 13px; text-align: left; }
                                                th { background-color: #f1f5f9; font-weight: 700; }
                                                a { color: #2563eb; text-decoration: underline; }
                                                ${css}
                                              </style>
                                            </head>
                                            <body>
                                              ${bodyContent}
                                            </body>
                                          </html>
                                        `}
                                        style={{ width: '100%', height: '360px', border: 'none', display: 'block', background: '#ffffff' }}
                                        sandbox="allow-popups"
                                      />
                                    </div>
                                  );
                                }

                                const isTabular = lower.includes('sl ') || lower.includes('uom') || lower.includes('qty') || lower.includes('discount') || lower.includes('rate') || lower.includes('make') || /^\s*\d+\s+[a-z]/im.test(cleanText);
                                const formattedText = autoFormatUnstructuredText(msgText);

                                return (
                                  <div 
                                    style={{ 
                                      whiteSpace: 'pre-wrap', 
                                      fontFamily: isTabular ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace' : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 
                                      fontSize: isTabular ? '0.84rem' : '0.88rem', 
                                      lineHeight: '1.7', 
                                      color: '#0f172a',
                                      wordBreak: 'break-word',
                                      backgroundColor: '#f8fafc',
                                      padding: '1rem 1.15rem',
                                      borderRadius: '8px',
                                      border: '1px solid #cbd5e1',
                                      maxHeight: '450px',
                                      overflowY: 'auto',
                                      letterSpacing: isTabular ? '-0.15px' : 'normal'
                                    }}
                                  >
                                    {formattedText}
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* ATTACHMENT OCR SECTION */}
                {(() => {
                  const ocrContent = selectedEmail.ocr_text || selectedEmail.ocr_snippet || '';
                  if (!ocrContent || !ocrContent.trim()) return null;

                  return (
                    <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '1.15rem', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                        <div style={{ fontSize: '0.85rem', color: '#0f172a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Paperclip size={15} color="#4f46e5" />
                          📄 Extracted PDF & Attachment Text (OCR)
                        </div>
                        <button style={{ padding: '0.22rem 0.6rem', fontSize: '0.72rem', borderRadius: '6px', cursor: 'pointer', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', color: copySuccess ? '#15803d' : '#475569', fontWeight: 600 }}
                          onClick={() => {
                            navigator.clipboard.writeText(ocrContent);
                            setCopySuccess(true);
                            setTimeout(() => setCopySuccess(false), 2000);
                          }}>
                          {copySuccess ? '✓ Copied!' : '📋 Copy OCR Text'}
                        </button>
                      </div>
                      <div style={{ maxHeight: '240px', overflowY: 'auto', fontSize: '0.82rem', lineHeight: '1.6', backgroundColor: '#f8fafc', padding: '0.9rem', borderRadius: '8px', border: '1px solid #e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#334155' }}>
                        {ocrContent}
                      </div>
                    </div>
                  );
                })()}

              </div>

              {/* RIGHT COLUMN: RICH EMAIL METADATA & SMART INSIGHTS */}
              <div className="email-modal-right-pane-light" style={{ flex: '0 0 350px', width: '350px', minWidth: '310px', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', overflowY: 'auto' }}>
                
                {/* Section Header */}
                <div style={{ padding: '0.9rem 1.15rem', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Info size={15} color="#6366f1" />
                    Email Intelligence & Actions
                  </div>
                </div>

                <div style={{ padding: '1rem 1.15rem', display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
                  
                  {/* 1. TENDER MATCH CARD */}
                  {(() => {
                    const matchInfo = getMatchSnippet(selectedEmail);
                    return (
                      <div style={{ padding: '0.85rem', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>🎯 Tender Match Info</span>
                          <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '4px', backgroundColor: selectedEmail.confidence === 'HIGH' ? '#ecfdf5' : '#fffbeb', color: selectedEmail.confidence === 'HIGH' ? '#065f46' : '#b45309', border: selectedEmail.confidence === 'HIGH' ? '1px solid #a7f3d0' : '1px solid #fde68a', fontWeight: 700 }}>
                            {selectedEmail.confidence || 'HIGH'} Confidence
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.8rem' }}>
                          <div><span style={{ color: '#64748b' }}>Matched Token:</span> <strong style={{ color: '#0f172a', wordBreak: 'break-all' }}>{selectedEmail.matchedToken || selectedEmail.matched_token || 'N/A'}</strong></div>
                          {(selectedEmail.docket_no || selectedEmail.tender_no) && (
                            <div><span style={{ color: '#64748b' }}>Docket / Tender:</span> <strong style={{ color: '#6366f1' }}>{selectedEmail.docket_no || selectedEmail.tender_no}</strong></div>
                          )}
                        </div>

                        {matchInfo && (
                          <div style={{ marginTop: '0.65rem', paddingTop: '0.55rem', borderTop: '1px solid #e2e8f0' }}>
                            <div style={{ fontSize: '0.73rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                              📍 Matched In:
                              <span style={{ color: '#1e40af', fontWeight: 700, backgroundColor: '#eff6ff', padding: '0.15rem 0.45rem', borderRadius: '4px', border: '1px solid #bfdbfe' }}>
                                {matchInfo.location}
                              </span>
                            </div>
                            {matchInfo.snippet && (
                              <div style={{ fontSize: '0.73rem', color: '#334155', backgroundColor: '#ffffff', padding: '0.5rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontStyle: 'italic', wordBreak: 'break-word', lineHeight: '1.4' }}>
                                "{matchInfo.snippet}"
                              </div>
                            )}
                          </div>
                        )}

                        {/* Match Verification Buttons if match_id exists */}
                    {selectedEmail.match_id && (
                      <div style={{ marginTop: '0.75rem', paddingTop: '0.6rem', borderTop: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Verify Match:</span>
                          {!showFeedbackForm && !feedbackLoading && (
                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              <button style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                                onClick={() => { setShowFeedbackForm(true); setFeedbackWasCorrect(true); }}>
                                ✓ Correct
                              </button>
                              <button style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', backgroundColor: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                                onClick={() => { setShowFeedbackForm(true); setFeedbackWasCorrect(false); }}>
                                ✕ Wrong
                              </button>
                            </div>
                          )}
                        </div>

                        {showFeedbackForm && (
                          <div style={{ padding: '0.5rem', backgroundColor: '#ffffff', borderRadius: '6px', border: '1px solid #cbd5e1', marginTop: '0.4rem' }}>
                            {feedbackWasCorrect ? (
                              <div style={{ display: 'flex', gap: '0.4rem' }}>
                                <button className="btn btn-primary" style={{ padding: '0.25rem 0.65rem', fontSize: '0.72rem', cursor: 'pointer' }}
                                  onClick={() => handleFeedback(selectedEmail.match_id, true)} disabled={feedbackLoading}>
                                  {feedbackLoading ? 'Saving...' : 'Confirm'}
                                </button>
                                <button className="btn btn-secondary" style={{ padding: '0.25rem 0.65rem', fontSize: '0.72rem', cursor: 'pointer' }}
                                  onClick={() => setShowFeedbackForm(false)}>Cancel</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <textarea
                                  placeholder="Why is this match wrong?"
                                  value={feedbackRule}
                                  onChange={(e) => setFeedbackRule(e.target.value)}
                                  style={{ padding: '0.35rem', fontSize: '0.72rem', borderRadius: '4px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', color: '#0f172a', minHeight: '45px', resize: 'vertical' }}
                                />
                                <div style={{ display: 'flex', gap: '0.3rem' }}>
                                  <button style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', backgroundColor: '#ef4444', color: '#ffffff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                                    onClick={() => handleFeedback(selectedEmail.match_id, false)} disabled={feedbackLoading || !feedbackRule.trim()}>
                                    {feedbackLoading ? 'Saving...' : 'Flag Wrong'}
                                  </button>
                                  <button className="btn btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem', cursor: 'pointer' }}
                                    onClick={() => setShowFeedbackForm(false)}>Cancel</button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

                  {/* 2. COMPANY & CATEGORY INFO */}
                  <div style={{ padding: '0.85rem', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                      🏢 Organization & Category
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.8rem' }}>
                      <div><span style={{ color: '#64748b' }}>Company:</span> <strong style={{ color: '#0f172a' }}>{selectedEmail.company || 'Laser Power & Infra'}</strong></div>
                      <div><span style={{ color: '#64748b' }}>Category:</span> <span style={{ color: '#475569' }}>{selectedEmail.category || 'Tender Inquiry'}</span></div>
                      <div><span style={{ color: '#64748b' }}>Priority:</span> <span style={{ color: '#6366f1', fontWeight: 600 }}>{selectedEmail.priority || 'Normal'}</span></div>
                    </div>
                  </div>

                  {/* 3. ATTACHMENTS LIST IF AVAILABLE */}
                  {selectedEmail.attach_names && (
                    <div style={{ padding: '0.85rem', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Paperclip size={12} color="#6366f1" />
                        Attached Files ({selectedEmail.attach_names.split(',').length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {(() => {
                          const names = selectedEmail.attach_names.split(',').map(n => n.trim());
                          const links = selectedEmail.attach_links ? selectedEmail.attach_links.split(',').map(l => l.trim()) : [];
                          return names.map((name, idx) => (
                            <a 
                              key={idx}
                              href={links[idx] || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#2563eb', textDecoration: 'none', padding: '0.2rem 0', wordBreak: 'break-all' }}
                            >
                              <FileText size={12} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                            </a>
                          ));
                        })()}
                      </div>
                    </div>
                  )}

                  {/* 4. EXTRACTED LINKS SECTION */}
                  {(() => {
                    const extractedLinks = extractEmailLinks(selectedEmail);
                    return (
                      <div style={{ padding: '0.85rem', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <ExternalLink size={13} color="#2563eb" />
                          Extracted Links ({extractedLinks.length})
                        </div>
                        {extractedLinks.length === 0 ? (
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>No external links found in email content.</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: '220px', overflowY: 'auto', paddingRight: '0.2rem' }}>
                            {extractedLinks.map((linkObj, idx) => (
                              <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.35rem 0.5rem', backgroundColor: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, flex: 1 }}>
                                  <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '4px', fontWeight: 600, flexShrink: 0 }}>
                                    {linkObj.domain}
                                  </span>
                                  <a 
                                    href={linkObj.url} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    style={{ fontSize: '0.75rem', color: '#2563eb', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                                    title={linkObj.url}
                                  >
                                    {linkObj.url}
                                  </a>
                                </div>
                                <button
                                  style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', color: '#334155', borderRadius: '4px', cursor: 'pointer', flexShrink: 0, fontWeight: 600 }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(linkObj.url);
                                    setCopyFeedbackIdx(idx);
                                    setTimeout(() => setCopyFeedbackIdx(null), 1500);
                                  }}
                                >
                                  {copyFeedbackIdx === idx ? '✓ Copied' : 'Copy'}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                </div>
              </div>

            </div>

            {/* FIXED LIGHT FOOTER */}
            <div className="email-modal-footer-light" style={{ padding: '0.75rem 1.5rem', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc', flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                style={{ borderRadius: '6px', padding: '0.4rem 1.25rem', fontSize: '0.82rem', cursor: 'pointer', backgroundColor: '#ffffff', color: '#334155', border: '1px solid #cbd5e1', fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }} 
                onClick={() => setSelectedEmail(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
{/* AI REPLY DRAFTING MODAL */}
      {replyTender && (
        <div className="modal-backdrop" onClick={() => setReplyTender(null)} style={{ zIndex: 1100 }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '800px', maxHeight: '90vh' }}>
            <div className="modal-header" style={{ padding: '1.25rem 1.75rem' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem' }}>AI Reply Drafting & Automated Sending</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  Tender: {replyTender.tenderFor || 'Tender Item'} (Docket: {replyTender.docketNo})
                </div>
              </div>
              <button className="modal-close" onClick={() => setReplyTender(null)}>✕</button>
            </div>

            <div className="modal-body" style={{ padding: '1.75rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Select Email Thread Dropdown (if multiple matched emails exist) */}
              {replyEmails.length > 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>SELECT EMAIL THREAD TO REPLY TO:</label>
                  <select
                    className="search-input"
                    style={{ padding: '0.55rem 1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '8px', width: '100%' }}
                    value={selectedReplyEmailId}
                    onChange={(e) => handleSelectReplyEmail(e.target.value)}
                  >
                    {replyEmails.map(email => (
                      <option key={`${email.id}-${email.docket_no || ''}-${email.tender_no || ''}-${email.matchedToken || email.matched_token || ''}`} value={email.id} style={{ backgroundColor: 'var(--bg-main)', color: 'var(--text-main)' }}>
                        {email.subject} ({new Date(email.date_received).toLocaleDateString()})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {draftLoading ? (
                <div className="loading-container" style={{ padding: '3rem' }}>
                  <div className="spinner"></div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Generating AI Suggested Reply...</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* Recipient Input */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>RECIPIENT (TO):</label>
                    <input
                      type="email"
                      className="search-input"
                      style={{ padding: '0.55rem 1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                      value={replyDraft.to}
                      onChange={(e) => setReplyDraft(prev => ({ ...prev, to: e.target.value }))}
                      placeholder="recipient@example.com"
                    />
                  </div>

                  {/* Subject Input */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>SUBJECT:</label>
                    <input
                      type="text"
                      className="search-input"
                      style={{ padding: '0.55rem 1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                      value={replyDraft.subject}
                      onChange={(e) => setReplyDraft(prev => ({ ...prev, subject: e.target.value }))}
                      placeholder="Email Subject"
                    />
                  </div>

                  {/* Reply Body Editor */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>AI-SUGGESTED REPLY BODY (EDITABLE):</label>
                    <textarea
                      rows={10}
                      className="search-input"
                      style={{
                        padding: '1rem',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        fontFamily: 'monospace',
                        fontSize: '0.9rem',
                        lineHeight: '1.5',
                        resize: 'vertical',
                        color: 'var(--text-main)'
                      }}
                      value={replyDraft.body}
                      onChange={(e) => setReplyDraft(prev => ({ ...prev, body: e.target.value }))}
                      placeholder="Type your email response here..."
                    />
                  </div>

                  {/* Attachments Section */}
                  {replyDraft.attachments && replyDraft.attachments.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                          Tender Email Attachments
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                          onClick={() => {
                            if (selectedAttachmentIndices.length === replyDraft.attachments.length) {
                              setSelectedAttachmentIndices([]);
                            } else {
                              setSelectedAttachmentIndices(replyDraft.attachments.map((_, idx) => idx));
                            }
                          }}
                        >
                          <Paperclip size={12} />
                          {selectedAttachmentIndices.length === replyDraft.attachments.length ? 'Remove Attachments' : 'Add Attachments'}
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {replyDraft.attachments.map((attach, idx) => (
                          <label
                            key={idx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.6rem',
                              padding: '0.55rem 0.75rem',
                              border: '1px solid var(--border-color)',
                              borderRadius: '6px',
                              backgroundColor: selectedAttachmentIndices.includes(idx) ? 'rgba(59, 130, 246, 0.14)' : 'rgba(255,255,255,0.03)',
                              cursor: 'pointer'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedAttachmentIndices.includes(idx)}
                              onChange={(e) => {
                                setSelectedAttachmentIndices(prev => (
                                  e.target.checked
                                    ? [...prev, idx]
                                    : prev.filter(item => item !== idx)
                                ));
                              }}
                            />
                            <FileText size={12} />
                            <span style={{ flex: 1, fontSize: '0.8rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {attach.name}
                            </span>
                            <a
                              href={attach.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="badge badge-info"
                              style={{ textDecoration: 'none', textTransform: 'none', borderRadius: '6px' }}
                            >
                              View <ExternalLink size={10} />
                            </a>
                          </label>
                        ))}
                      </div>
                      <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {selectedAttachmentIndices.length} attachment link{selectedAttachmentIndices.length === 1 ? '' : 's'} will be included with the reply.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ padding: '1.25rem 1.75rem', display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setReplyTender(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSendEmail}
                disabled={draftLoading || sendLoading}
              >
                {sendLoading ? 'Sending Email...' : 'Send Auto Email'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RICH EMAIL DETAIL INSPECTOR MODAL */}
      {emailDetailModalOpen && (detailedEmailLoading || detailedEmail) && (
        <div className="modal-backdrop" onClick={() => setEmailDetailModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: '1280px', maxWidth: '95vw', height: '88vh', maxHeight: '90vh', backgroundColor: '#ffffff', borderRadius: '14px', border: '1px solid #cbd5e1', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="modal-header">
              <div>
                <h2>Email Inspector</h2>
                {detailedEmail && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
                  ID: {detailedEmail.thread_id || detailedEmail.id} | Category: <span className="badge badge-info">{detailedEmail.category || 'General'}</span>
                  {detailedEmail.is_fallback_company && detailedEmail.fallback_company && (
                    <span style={{ marginLeft: '0.75rem', color: '#f59e0b' }}>
                      | <strong>Fallback company:</strong> {detailedEmail.fallback_company} (TEMP — unverified)
                    </span>
                  )}
                  {detailedEmail.to_details && (
                    <span style={{ marginLeft: '0.75rem', color: 'var(--color-secondary)' }}>
                      | <strong>Receiver:</strong> {detailedEmail.to_details}
                    </span>
                  )}
                  {detailedEmail.cc_details && (
                    <span style={{ marginLeft: '0.75rem', color: 'var(--color-secondary)' }}>
                      | <strong>CC:</strong> {detailedEmail.cc_details}
                    </span>
                  )}
                </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {detailedEmail && (
                  <>
                    <a
                      href={detailedEmail.thread_id ? `https://mail.google.com/mail/#all/${detailedEmail.thread_id}` : `https://mail.google.com/mail/#search/subject:"${encodeURIComponent((detailedEmail.subject || '').replace(/^(re|fwd):\s*/i, '').trim())}"`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        padding: '0.35rem 0.75rem',
                        backgroundColor: '#ea4335',
                        color: '#ffffff',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        borderRadius: '6px',
                        textDecoration: 'none',
                        boxShadow: '0 1px 3px rgba(234,67,53,0.3)',
                        transition: 'opacity 0.2s'
                      }}
                      title="Open this exact thread directly in Gmail"
                    >
                      <ExternalLink size={12} color="#ffffff" />
                      Open in Gmail
                    </a>

                    {detailedEmail.subject && (
                      <a
                        href={`https://mail.google.com/mail/#search/subject:"${encodeURIComponent(detailedEmail.subject.replace(/^(re|fwd):\s*/i, '').trim())}"`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.35rem 0.65rem',
                          backgroundColor: '#ffffff',
                          color: '#ea4335',
                          border: '1px solid #ea4335',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          borderRadius: '6px',
                          textDecoration: 'none',
                          transition: 'opacity 0.2s'
                        }}
                        title="Search by Email Subject in Gmail"
                      >
                        <Search size={12} color="#ea4335" />
                        Search Subject
                      </a>
                    )}
                  </>
                )}
                <button className="modal-close" onClick={() => setEmailDetailModalOpen(false)}>✕</button>
              </div>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto', padding: '1.5rem' }}>
              {detailedEmailLoading && !detailedEmail ? (
                <div className="loading-container" style={{ padding: '3rem' }}>
                  <div className="spinner"></div>
                  <p>Loading email details...</p>
                </div>
              ) : !detailedEmail ? null : (
              <>
              {/* Metadata Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', padding: '1rem', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                <div style={{ gridColumn: 'span 2' }}><strong>Subject:</strong> <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{detailedEmail.subject}</span></div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <strong>Sender:</strong> <span style={{ color: 'var(--color-secondary)' }}>{detailedEmail.sender}</span>
                    <div className="company-badge-list" style={{ display: 'inline-flex' }}>
                      {renderSenderBadges(detailedEmail).filter(b => b.type !== 'outsider').map((b, i) => (
                        <React.Fragment key={i}>
                          {renderCustomBadge(b.type, b.label, b.color)}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  {detailedEmail.to_details ? (
                    <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', color: 'var(--color-secondary)', background: 'rgba(16, 185, 129, 0.08)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.2)', display: 'inline-block' }}>
                      <strong style={{ color: 'var(--text-main)' }}>Receiver:</strong> {detailedEmail.to_details}
                    </div>
                  ) : (
                    <div style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      <strong>Receiver:</strong> None
                    </div>
                  )}
                  {detailedEmail.cc_details ? (
                    <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', color: 'var(--color-secondary)', background: 'rgba(99, 102, 241, 0.08)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid rgba(99, 102, 241, 0.2)', display: 'inline-block' }}>
                      <strong style={{ color: 'var(--text-main)' }}>CC:</strong> {detailedEmail.cc_details}
                    </div>
                  ) : (
                    <div style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      <strong>CC:</strong> None
                    </div>
                  )}
                </div>
                <div><strong>Date Received:</strong> {formatDateTime(detailedEmail.date || detailedEmail.date_received)}</div>
                <div>
                  <strong>Priority:</strong> <span className={`badge ${detailedEmail.priority === 'HIGH' ? 'badge-danger' : detailedEmail.priority === 'MEDIUM' ? 'badge-warning' : 'badge-muted'}`} style={{ marginLeft: '0.25rem' }}>{detailedEmail.priority || 'LOW'}</span>
                </div>
              </div>

              {/* Labels Management Panel */}
              <div style={{ padding: '1rem', backgroundColor: 'rgba(255,255,255,0.01)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Manage Custom Labels</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                  {detailedEmail.user_labels ? (
                    detailedEmail.user_labels.split(',').map(lbl => {
                      const label = lbl.trim();
                      if (!label) return null;
                      return (
                        <span key={label} className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>
                          {label}
                          <span style={{ cursor: 'pointer', fontWeight: 'bold' }} onClick={() => handleRemoveLabel(detailedEmail, label)}>✕</span>
                        </span>
                      );
                    })
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>No custom labels assigned.</span>
                  )}
                </div>

                {/* Available Labels Quick Toggles */}
                {availableLabels.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '500', marginRight: '0.25rem' }}>Quick Toggle:</span>
                    {availableLabels.map(lbl => {
                      const existing = detailedEmail.user_labels 
                        ? detailedEmail.user_labels.split(',').map(x => x.trim().toLowerCase())
                        : [];
                      const isAssigned = existing.includes(lbl.toLowerCase());
                      
                      return (
                        <button
                          key={lbl}
                          className={`btn ${isAssigned ? 'btn-primary' : 'btn-secondary'}`}
                          style={{
                            padding: '0.3rem 0.75rem',
                            borderRadius: '15px',
                            fontSize: '0.78rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            cursor: 'pointer',
                            border: isAssigned ? 'none' : '1px solid var(--border-color)',
                            background: isAssigned ? 'var(--color-primary)' : 'rgba(255,255,255,0.02)',
                            color: isAssigned ? 'white' : 'var(--text-main)',
                            transition: 'all 0.2s ease'
                          }}
                          onClick={() => {
                            if (isAssigned) {
                              handleRemoveLabel(detailedEmail, lbl);
                            } else {
                              handleAddLabel(detailedEmail, lbl);
                            }
                          }}
                        >
                          {isAssigned ? '✓' : '+'} {lbl}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  {/* Custom label input for brand-new labels */}
                  <input 
                    type="text" 
                    placeholder="Create new label..." 
                    className="search-input" 
                    style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', width: '200px' }}
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddLabel(detailedEmail, labelInput);
                        setLabelInput('');
                      }
                    }}
                  />
                  <button 
                    className="btn btn-secondary" 
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                    onClick={() => {
                      handleAddLabel(detailedEmail, labelInput);
                      setLabelInput('');
                    }}
                  >
                    Create Label
                  </button>
                </div>
              </div>

              {/* Email Content Body */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Email Message Content
                  </div>
                  {/* View Mode Toggle (if multiple messages exist) */}
                  {detailedEmail.body && threadMessages.length > 1 && (
                    <div style={{ display: 'flex', gap: '0.25rem', backgroundColor: 'rgba(255,255,255,0.03)', padding: '0.2rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <button
                        className={`btn btn-small ${emailViewMode === 'threaded' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px' }}
                        onClick={() => setEmailViewMode('threaded')}
                      >
                        Threaded View ({threadMessages.length})
                      </button>
                      <button
                        className={`btn btn-small ${emailViewMode === 'raw' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px' }}
                        onClick={() => setEmailViewMode('raw')}
                      >
                        Raw View
                      </button>
                    </div>
                  )}
                </div>

                {emailViewMode === 'threaded' || threadMessages.length <= 1 ? (
                  /* Beautiful Conversation Card UI for ALL Emails (Single & Multiple) */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative', paddingLeft: threadMessages.length > 1 ? '1.5rem' : '0', marginTop: '0.5rem' }}>
                    {threadMessages.length > 1 && (
                      <div style={{ position: 'absolute', left: '0.75rem', top: '1.5rem', bottom: '1.5rem', width: '2px', background: 'var(--border-color)', zIndex: 1 }}></div>
                    )}

                    {(threadMessages.length > 0 ? threadMessages : [{ text: detailedEmail.body, sender: detailedEmail.sender, date: detailedEmail.date_received || detailedEmail.date }]).map((msg, idx) => {
                      const isExpanded = expandedThreadMessages[idx] !== false;
                      const msgSender = msg.sender || msg.defaultSender || detailedEmail.sender || 'Sender';
                      const stepLabel = threadMessages.length > 1
                        ? (idx === 0 ? '📩 Latest Email' : (idx === threadMessages.length - 1 ? '✉️ Original Inquiry' : `💬 Reply #${threadMessages.length - idx}`))
                        : '📩 Main Message';

                      return (
                        <div 
                          key={idx} 
                          style={{
                            position: 'relative',
                            zIndex: 2,
                            border: '1px solid var(--border-color)',
                            borderRadius: '12px',
                            backgroundColor: 'var(--bg-card)',
                            overflow: 'hidden',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                            transition: 'box-shadow var(--transition-fast)'
                          }}
                        >
                          {/* Message Header */}
                          <div 
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '0.85rem 1.25rem',
                              backgroundColor: 'rgba(255,255,255,0.02)',
                              borderBottom: isExpanded ? '1px solid var(--border-color)' : 'none',
                              cursor: 'pointer',
                              userSelect: 'none'
                            }}
                            onClick={() => setExpandedThreadMessages(prev => ({ ...prev, [idx]: !prev[idx] }))}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', minWidth: 0, flex: 1 }}>
                              {/* Avatar Icon */}
                              <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                backgroundColor: idx === 0 ? '#6366f1' : '#cbd5e1',
                                color: '#ffffff',
                                fontWeight: 700,
                                fontSize: '0.85rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                              }}>
                                {msgSender.replace(/<.*?>/g, '').trim().charAt(0).toUpperCase()}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.9rem' }}>
                                    {msgSender}
                                  </span>
                                  <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '4px', backgroundColor: idx === 0 ? '#eff6ff' : '#f8fafc', color: idx === 0 ? '#1d4ed8' : '#475569', border: '1px solid ' + (idx === 0 ? '#bfdbfe' : '#cbd5e1'), fontWeight: 700 }}>
                                    {stepLabel}
                                  </span>
                                </div>
                                {(msg.date || detailedEmail.date || detailedEmail.date_received) && (
                                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                    📅 {msg.date || formatDateTime(detailedEmail.date || detailedEmail.date_received)}
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.03)', padding: '0.2rem 0.55rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontWeight: 600 }}>
                                {isExpanded ? 'Collapse' : 'Expand'}
                              </span>
                            </div>
                          </div>

                          {/* Message Body */}
                          {isExpanded && (
                            <div style={{ padding: '1.25rem', backgroundColor: '#ffffff' }}>
                              {/* Headers Details Block */}
                              {(msg.to || msg.cc || msg.subject || (idx === 0 && detailedEmail.to_details)) && (
                                <div style={{ 
                                  fontSize: '0.78rem', 
                                  color: 'var(--text-muted)', 
                                  backgroundColor: '#f8fafc',
                                  padding: '0.6rem 0.85rem',
                                  borderRadius: '6px',
                                  border: '1px solid #e2e8f0',
                                  display: 'flex', 
                                  flexDirection: 'column', 
                                  gap: '0.25rem', 
                                  marginBottom: '1rem'
                                }}>
                                  {(msg.subject || (idx === 0 && detailedEmail.subject)) && <div><strong style={{ color: 'var(--text-main)' }}>Subject:</strong> {msg.subject || detailedEmail.subject}</div>}
                                  {(msg.to || (idx === 0 && detailedEmail.to_details)) && <div><strong style={{ color: 'var(--text-main)' }}>Receiver:</strong> {msg.to || detailedEmail.to_details}</div>}
                                  {(msg.cc || (idx === 0 && detailedEmail.cc_details)) && <div><strong style={{ color: 'var(--text-main)' }}>Cc:</strong> {msg.cc || detailedEmail.cc_details}</div>}
                                </div>
                              )}

                              {/* Message Content */}
                              {(() => {
                                let rawMsgText = msg.body || msg.text || '';
                                let msgText = rawMsgText.replace(/^--- Message \d+ From:.*?---\s*/gi, '').trim();
                                msgText = msgText.replace(/(\r?\n){3,}/g, '\n\n');

                                const { css, cleanText } = extractCssFromText(msgText);
                                const lower = cleanText.toLowerCase();
                                
                                const hasHtml = cleanText && (
                                  lower.includes('<html') || 
                                  lower.includes('<div') || 
                                  lower.includes('<p') || 
                                  lower.includes('<span') ||
                                  lower.includes('<table') ||
                                  lower.includes('<body') || 
                                  lower.includes('<br') || 
                                  lower.includes('<a ') ||
                                  lower.includes('<!doctype html') ||
                                  /<[a-z][\s\S]*>/i.test(cleanText)
                                );

                                const hasCss = css.trim().length > 0;

                                if (hasHtml || hasCss) {
                                  const bodyContent = hasHtml ? cleanText : `<div style="white-space: pre-wrap; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.65;">${cleanText}</div>`;
                                  
                                  return (
                                    <div style={{ border: '1px solid #cbd5e1', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                                      <iframe
                                        title={`Message Content ${idx}`}
                                        srcDoc={`
                                          <!DOCTYPE html>
                                          <html>
                                            <head>
                                              <meta charset="utf-8">
                                              <style>
                                                body {
                                                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                                                  font-size: 14px;
                                                  line-height: 1.65;
                                                  color: #1e293b;
                                                  margin: 1.1rem;
                                                  word-wrap: break-word;
                                                }
                                                img { max-width: 100%; height: auto; }
                                                table { border-collapse: collapse; width: 100%; margin: 0.8rem 0; }
                                                th, td { border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 13px; text-align: left; }
                                                th { background-color: #f1f5f9; font-weight: 700; }
                                                a { color: #2563eb; text-decoration: underline; }
                                                ${css}
                                              </style>
                                            </head>
                                            <body>
                                              ${bodyContent}
                                            </body>
                                          </html>
                                        `}
                                        style={{ width: '100%', height: '360px', border: 'none', display: 'block', background: '#ffffff' }}
                                        sandbox="allow-popups"
                                      />
                                    </div>
                                  );
                                }

                                const isTabular = lower.includes('sl ') || lower.includes('uom') || lower.includes('qty') || lower.includes('discount') || lower.includes('rate') || lower.includes('make') || /^\s*\d+\s+[a-z]/im.test(cleanText);
                                const formattedText = autoFormatUnstructuredText(msgText);

                                return (
                                  <div 
                                    style={{ 
                                      whiteSpace: 'pre-wrap', 
                                      fontFamily: isTabular ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace' : '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 
                                      fontSize: isTabular ? '0.84rem' : '0.88rem', 
                                      lineHeight: '1.7', 
                                      color: '#0f172a',
                                      wordBreak: 'break-word',
                                      backgroundColor: '#f8fafc',
                                      padding: '1rem 1.15rem',
                                      borderRadius: '8px',
                                      border: '1px solid #cbd5e1',
                                      maxHeight: '450px',
                                      overflowY: 'auto',
                                      letterSpacing: isTabular ? '-0.15px' : 'normal'
                                    }}
                                  >
                                    {formattedText}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Standard / Raw View rendering with HTML & CSS Extractor */
                  (() => {
                    const bodyText = detailedEmail.body || '';
                    if (!bodyText.trim()) {
                      return <div style={{ padding: '1.5rem', color: '#64748b', fontStyle: 'italic' }}>No message content available.</div>;
                    }

                    const { css, cleanText } = extractCssFromText(bodyText);
                    const lower = cleanText.toLowerCase();

                    const hasHtml = (
                      lower.includes('<html') ||
                      lower.includes('<div') ||
                      lower.includes('<p') ||
                      lower.includes('<span') ||
                      lower.includes('<table') ||
                      lower.includes('<body') ||
                      lower.includes('<br') ||
                      lower.includes('<a ') ||
                      lower.includes('<!doctype html') ||
                      /<[a-z][\s\S]*>/i.test(cleanText)
                    );

                    const hasCss = css.trim().length > 0;

                    if (hasHtml || hasCss) {
                      const bodyContent = hasHtml ? cleanText : `<div style="white-space: pre-wrap; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6;">${cleanText}</div>`;
                      return (
                        <div style={{ border: '1px solid #cbd5e1', borderRadius: '10px', overflow: 'hidden', backgroundColor: '#ffffff', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                          <iframe
                            title="Rich Email Content"
                            srcDoc={`
                              <!DOCTYPE html>
                              <html>
                                <head>
                                  <meta charset="utf-8">
                                  <meta name="viewport" content="width=device-width, initial-scale=1">
                                  <style>
                                    body {
                                      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                                      font-size: 14px;
                                      line-height: 1.6;
                                      color: #1e293b;
                                      margin: 1.2rem;
                                      word-wrap: break-word;
                                      background-color: #ffffff;
                                    }
                                    img { max-width: 100%; height: auto; }
                                    table { border-collapse: collapse; max-width: 100%; }
                                    a { color: #2563eb; text-decoration: underline; }
                                    ${css}
                                  </style>
                                </head>
                                <body>
                                  ${bodyContent}
                                </body>
                              </html>
                            `}
                            style={{ width: '100%', height: '520px', border: 'none', display: 'block', background: '#ffffff' }}
                            sandbox="allow-popups"
                          />
                        </div>
                      );
                    }

                    return (
                      <div style={{ border: '1px solid #cbd5e1', borderRadius: '10px', padding: '1.25rem', backgroundColor: '#ffffff', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', fontSize: '0.9rem', lineHeight: '1.65', color: '#1e293b', maxHeight: '520px', overflowY: 'auto' }}>
                        {bodyText}
                      </div>
                    );
                  })()
                )}
              </div>

              {/* Extracted Email Links Section */}
              {(() => {
                const links = extractEmailLinks(detailedEmail);
                if (!links || links.length === 0) return null;

                return (
                  <div style={{ backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '1.15rem', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                      <div style={{ fontSize: '0.85rem', color: '#0f172a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <ExternalLink size={15} color="#2563eb" />
                        🔗 Extracted Email Links ({links.length})
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '220px', overflowY: 'auto' }}>
                      {links.map((item, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', backgroundColor: '#f8fafc', padding: '0.45rem 0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: 1 }}>
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#1d4ed8', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', padding: '0.1rem 0.4rem', borderRadius: '4px', textTransform: 'lowercase', flexShrink: 0 }}>
                              {item.domain}
                            </span>
                            <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.78rem', color: '#2563eb', textDecoration: 'none', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.url}>
                              {item.url}
                            </a>
                          </div>
                          <button
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', borderRadius: '4px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', color: copyFeedbackIdx === `inspector_${idx}` ? '#15803d' : '#475569', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}
                            onClick={() => {
                              navigator.clipboard.writeText(item.url);
                              setCopyFeedbackIdx(`inspector_${idx}`);
                              setTimeout(() => setCopyFeedbackIdx(null), 2000);
                            }}
                          >
                            {copyFeedbackIdx === `inspector_${idx}` ? '✓ Copied' : '📋 Copy'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Attachments Section */}
              {detailedEmail.attach_names ? (
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Attached Files (Google Drive)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
                    {(() => {
                      const names = detailedEmail.attach_names.split(',').map(n => n.trim());
                      const links = detailedEmail.attach_links ? detailedEmail.attach_links.split(',').map(l => l.trim()) : [];
                      return names.map((name, idx) => {
                        const link = links[idx] || '#';
                        return (
                          <a 
                            key={idx}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="card card-interactive"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', textDecoration: 'none', border: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)' }}
                          >
                            <Paperclip size={16} color="var(--color-primary-light)" />
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {name}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>Click to view in Drive</div>
                            </div>
                            <ExternalLink size={14} color="var(--text-muted)" />
                          </a>
                        );
                      });
                    })()}
                  </div>
                </div>
              ) : null}
              </>
              )}

              {detailedEmail?.ai_summary && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>AI-Generated Summary</div>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-main)', fontStyle: 'italic', backgroundColor: 'rgba(255,255,255,0.01)', padding: '1rem', borderRadius: '8px', borderLeft: '3px solid var(--color-primary-light)', lineHeight: '1.5' }}>
                    {detailedEmail.ai_summary}
                  </p>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ padding: '1.25rem 1.75rem' }}>
              <button className="btn btn-secondary" onClick={() => setEmailDetailModalOpen(false)}>Close Inspector</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
