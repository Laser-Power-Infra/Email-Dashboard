/**
 * Gmail mailbox service for the shared mailbox.
 *
 * Provides live Gmail read/write operations used by the Mailbox tab and by the
 * existing tender email screens. The MySQL database remains the tender-matching
 * source of truth; Gmail is the source of truth for mailbox state.
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const iconv = require('iconv-lite');

const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];

const FOLDER_QUERIES = {
  all: 'in:anywhere -in:trash -in:spam',
  inbox: 'in:inbox',
  sent: 'in:sent',
  starred: 'is:starred',
  archive: 'in:anywhere -in:inbox -in:sent -in:drafts -in:trash -in:spam',
  spam: 'in:spam',
  trash: 'in:trash',
  drafts: 'in:drafts',
};

const DEFAULT_PAGE_SIZE = Math.max(1, Math.min(Number(process.env.MAILBOX_PAGE_SIZE) || 10, 25));
const LIST_CACHE_TTL_MS = Math.max(5, Number(process.env.MAILBOX_LIST_CACHE_TTL_SECONDS) || 60) * 1000;
const CACHE_TTL_MS = Math.max(30, Number(process.env.MAILBOX_CACHE_TTL_SECONDS) || 300) * 1000;
const DETAIL_CACHE_TTL_MS = Math.min(CACHE_TTL_MS, 2 * 60 * 1000);
const MAX_CONCURRENCY = Math.max(1, Math.min(Number(process.env.MAILBOX_MAX_CONCURRENCY) || 2, 5));
const QUOTA_RETRY_SECONDS = Math.max(10, Number(process.env.GMAIL_QUOTA_RETRY_SECONDS) || 60);

let gmailAuthClient = null;
let gmailService = null;
let gmailTokenPath = null;
let driveAuthClient = null;
let driveService = null;

let profileCache = null;
let profileCacheAt = 0;
let profileError = null;
let profileErrorAt = 0;

const listCache = new Map();
const threadMetadataCache = new Map();
const threadSummaryCache = new Map();
const threadDetailCache = new Map();
const draftIdCache = new Map();
const countsCache = { data: null, at: 0 };
const inFlight = new Map();

function findAuthFile(filename) {
  const candidates = [
    path.join(__dirname, 'root_config', filename),
    path.join('/app', 'root_config', filename),
    path.join(__dirname, '..', filename),
    path.join(process.cwd(), filename),
    path.join(process.cwd(), '..', filename),
    path.join(__dirname, '..', 'Emails_agent', filename),
    path.join(process.cwd(), 'Emails_agent', filename),
    path.join(__dirname, 'Emails_agent', filename),
    path.join(__dirname, filename),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch (e) {}
  }
  return null;
}

function resolvePath(explicitPath, filename, { allowMissing = false } = {}) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
      }
    } catch (e) {}
    if (!allowMissing) {
      throw new Error(`${filename} was not found at ${resolved}`);
    }
    console.warn(`[Mailbox] ${filename} not found at ${resolved}; falling back to the existing root file.`);
  }
  return findAuthFile(filename);
}


function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${label} at ${filePath}: ${err.message}`);
  }
}

function loadMailboxToken() {
  const tokenPath = resolvePath(process.env.MAILBOX_TOKEN_PATH, 'token.json', { allowMissing: true });
  if (tokenPath) {
    return { token: readJsonFile(tokenPath, 'mailbox token'), tokenPath };
  }
  if (process.env.GOOGLE_TOKEN_JSON) {
    const token = typeof process.env.GOOGLE_TOKEN_JSON === 'string'
      ? JSON.parse(process.env.GOOGLE_TOKEN_JSON)
      : process.env.GOOGLE_TOKEN_JSON;
    return { token, tokenPath: null };
  }
  throw new Error('Mailbox token was not found. Set MAILBOX_TOKEN_PATH or run Backend/scripts/gmail-authorize.js.');
}

function loadMailboxCredentials() {
  const credentialsPath = resolvePath(process.env.MAILBOX_CREDENTIALS_PATH, 'credentials.json', { allowMissing: true });
  if (!credentialsPath) {
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      return typeof process.env.GOOGLE_CREDENTIALS_JSON === 'string'
        ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
        : process.env.GOOGLE_CREDENTIALS_JSON;
    }
    throw new Error('Mailbox credentials were not found. Set MAILBOX_CREDENTIALS_PATH.');
  }
  return readJsonFile(credentialsPath, 'mailbox credentials');
}

function loadDriveToken() {
  const tokenPath = resolvePath(process.env.DRIVE_TOKEN_PATH, 'token.json');
  if (tokenPath) {
    return { token: readJsonFile(tokenPath, 'drive token'), tokenPath };
  }
  if (process.env.GOOGLE_TOKEN_JSON) {
    const token = typeof process.env.GOOGLE_TOKEN_JSON === 'string'
      ? JSON.parse(process.env.GOOGLE_TOKEN_JSON)
      : process.env.GOOGLE_TOKEN_JSON;
    return { token, tokenPath: null };
  }
  throw new Error('Drive token was not found. The existing root token.json is required for Drive attachments.');
}

function loadDriveCredentials() {
  const credentialsPath = resolvePath(process.env.DRIVE_CREDENTIALS_PATH, 'credentials.json');
  if (!credentialsPath) {
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      return typeof process.env.GOOGLE_CREDENTIALS_JSON === 'string'
        ? JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
        : process.env.GOOGLE_CREDENTIALS_JSON;
    }
    throw new Error('Drive credentials were not found. The existing root credentials.json is required for Drive attachments.');
  }
  return readJsonFile(credentialsPath, 'drive credentials');
}

function buildAuthClient(credentials, loadedToken, label) {
  const config = credentials.installed || credentials.web;
  if (!config) throw new Error(`${label} credentials are missing the installed/web OAuth client.`);

  const token = loadedToken.token || loadedToken;
  const tokenPath = loadedToken.tokenPath || null;

  const client = new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    (config.redirect_uris && config.redirect_uris[0]) || 'http://localhost'
  );
  client.setCredentials(token);

  client.on('tokens', (newTokens) => {
    if (!newTokens) return;
    const merged = { ...token, ...newTokens };
    if (tokenPath) {
      try {
        fs.writeFileSync(tokenPath, JSON.stringify(merged, null, 2), 'utf8');
        console.log(`[${label} Auth] Refreshed access token saved to ${tokenPath}`);
      } catch (err) {
        console.warn(`[${label} Auth] Could not write refreshed token:`, err.message);
      }
    }
  });

  return client;
}

function getGmailAuthClient() {
  if (gmailAuthClient) return gmailAuthClient;
  const loaded = loadMailboxToken();
  gmailTokenPath = loaded.tokenPath;
  gmailAuthClient = buildAuthClient(loadMailboxCredentials(), loaded, 'Gmail');
  gmailService = google.gmail({ version: 'v1', auth: gmailAuthClient });
  return gmailAuthClient;
}

function getGmailService() {
  getGmailAuthClient();
  return gmailService;
}

function getDriveAuthClient() {
  if (driveAuthClient) return driveAuthClient;
  const loaded = loadDriveToken();
  driveAuthClient = buildAuthClient(loadDriveCredentials(), loaded, 'Drive');
  driveService = google.drive({ version: 'v3', auth: driveAuthClient });
  return driveAuthClient;
}

function getDriveService() {
  getDriveAuthClient();
  return driveService;
}

// Lazy getters prevent a missing Drive token from breaking Gmail-only features.
function getServices() {
  return {
    get gmail() { return getGmailService(); },
    get drive() { return getDriveService(); },
    get auth() { return getGmailAuthClient(); },
  };
}

function getGrantedScopes() {
  const loaded = loadMailboxToken();
  const token = loaded.token || loaded;
  return Array.isArray(token.scopes) ? token.scopes : [];
}

function getCapabilities() {
  const scopes = getGrantedScopes();
  const fullMail = scopes.includes('https://mail.google.com/');
  return {
    canSend: fullMail ||
      scopes.includes('https://www.googleapis.com/auth/gmail.send') ||
      scopes.includes('https://www.googleapis.com/auth/gmail.modify'),
    canModify: fullMail || scopes.includes('https://www.googleapis.com/auth/gmail.modify'),
    scopes,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isQuotaError(err) {
  const message = String((err && (err.message || err)) || '');
  return /quota|rate limit|rateLimitExceeded|userRateLimitExceeded|429|too many requests/i.test(message);
}

function getRetryAfterSeconds(err) {
  const headers = err && err.response && err.response.headers;
  const raw = headers && (headers['retry-after'] || headers['Retry-After']);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : QUOTA_RETRY_SECONDS;
}

function toQuotaError(err) {
  const error = new Error(
    `Gmail rate limit reached. Please retry in ${getRetryAfterSeconds(err)} seconds.`
  );
  error.code = 'GMAIL_QUOTA';
  error.statusCode = 429;
  error.retryAfter = getRetryAfterSeconds(err);
  error.cause = err;
  return error;
}

async function withGmailRetry(fn, label) {
  const maxRetries = Math.max(0, Number(process.env.GMAIL_QUOTA_RETRIES) || 1);
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isQuotaError(err) || attempt >= maxRetries) break;
      const waitMs = Math.min(getRetryAfterSeconds(err), 5) * 1000;
      console.warn(`[Gmail] ${label} hit quota, retrying in ${Math.round(waitMs / 1000)}s...`);
      await sleep(waitMs);
    }
  }
  if (isQuotaError(lastError)) throw toQuotaError(lastError);
  throw lastError;
}

function cacheGet(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(map, key, data, ttlMs) {
  map.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

function dedupe(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = Promise.resolve().then(fn).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

function clearMailboxCache() {
  listCache.clear();
  threadMetadataCache.clear();
  threadSummaryCache.clear();
  threadDetailCache.clear();
  draftIdCache.clear();
  countsCache.data = null;
  countsCache.at = 0;
  profileCache = null;
  profileCacheAt = 0;
  profileError = null;
  profileErrorAt = 0;
}

function normalizeCharset(charset) {
  const clean = String(charset || 'utf-8').trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (['utf8', 'utf-8', 'us-ascii', 'ascii'].includes(clean)) return 'utf8';
  if (iconv.encodingExists(clean)) return clean;
  return 'utf8';
}

function getCharset(contentType) {
  const match = String(contentType || '').match(/charset\s*=\s*"?([^";]+)"?/i);
  return normalizeCharset(match ? match[1] : 'utf-8');
}

function decodeBase64Url(data) {
  if (!data) return Buffer.alloc(0);
  return Buffer.from(data, 'base64url');
}

function decodePartBody(part) {
  const data = part && part.body && part.body.data;
  if (!data) return '';
  const buffer = decodeBase64Url(data);
  const headers = headerMap(part);
  return iconv.decode(buffer, getCharset(headers['content-type']));
}

function headerMap(partOrMessage) {
  const headers = {};
  const list = (partOrMessage && partOrMessage.payload && partOrMessage.payload.headers) ||
    (partOrMessage && partOrMessage.headers) || [];
  for (const header of list) {
    if (!header || !header.name) continue;
    headers[String(header.name).toLowerCase()] = header.value || '';
  }
  return headers;
}

function decodeMimeWords(value) {
  if (!value) return '';
  return String(value).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset, encoding, text) => {
    try {
      let buffer;
      if (String(encoding).toUpperCase() === 'B') {
        buffer = Buffer.from(text, 'base64');
      } else {
        const qp = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (m, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        );
        buffer = Buffer.from(qp, 'binary');
      }
      return iconv.decode(buffer, normalizeCharset(charset));
    } catch (err) {
      return whole;
    }
  });
}

function decodeHeaderValue(value) {
  return decodeMimeWords(String(value || '').replace(/\r?\n\s+/g, ' ').trim());
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text) {
  return `<div style="white-space:pre-wrap;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.65;color:#1e293b;">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
}

function partHasFilename(part) {
  return Boolean(part && (part.filename || (part.body && part.body.attachmentId && part.filename)));
}

function collectParts(part, state) {
  if (!part) return;

  const mimeType = String(part.mimeType || '').toLowerCase();
  const headers = headerMap(part);
  const filename = part.filename || '';
  const body = part.body || {};
  const contentId = String(headers['content-id'] || '').replace(/^<|>$/g, '');
  const disposition = String(headers['content-disposition'] || '').toLowerCase();
  const isAttachment = Boolean(filename && body.attachmentId);
  const isInline = Boolean(contentId) || disposition.includes('inline');

  if (isAttachment) {
    state.attachments.push({
      messageId: state.messageId,
      attachmentId: body.attachmentId,
      filename: filename || `attachment-${state.attachments.length + 1}`,
      mimeType: mimeType || 'application/octet-stream',
      size: Number(body.size) || 0,
      contentId,
      inline: isInline,
    });
    if (isInline && contentId) {
      state.inlineAttachments.push({
        contentId,
        attachmentId: body.attachmentId,
        mimeType: mimeType || 'application/octet-stream',
        filename,
      });
    }
  } else if (mimeType === 'text/html' && !filename && body.data) {
    state.htmlParts.push(decodePartBody(part));
  } else if (mimeType === 'text/plain' && !filename && body.data) {
    state.textParts.push(decodePartBody(part));
  }

  for (const child of part.parts || []) {
    collectParts(child, state);
  }
}

function rewriteCidUrls(html, messageId, inlineAttachments) {
  if (!html || !inlineAttachments || inlineAttachments.length === 0) return html;
  let output = html;
  for (const inline of inlineAttachments) {
    if (!inline.contentId || !inline.attachmentId) continue;
    const url = `/api/mailbox/attachments/${encodeURIComponent(messageId)}/${encodeURIComponent(inline.attachmentId)}` +
      `?inline=1&mime=${encodeURIComponent(inline.mimeType || 'application/octet-stream')}` +
      `&filename=${encodeURIComponent(inline.filename || 'inline-image')}`;
    const escapedCid = inline.contentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`cid:${escapedCid}`, 'gi');
    output = output.replace(regex, url);
  }
  return output;
}

function parseMessage(message) {
  const headers = headerMap(message);
  const state = {
    messageId: message.id,
    htmlParts: [],
    textParts: [],
    attachments: [],
    inlineAttachments: [],
  };
  collectParts(message.payload, state);

  let html = state.htmlParts.join('\n\n').trim();
  let text = state.textParts.join('\n\n').trim();
  if (!html && text) html = textToHtml(text);
  if (!text && html) text = htmlToText(html);

  html = rewriteCidUrls(html, message.id, state.inlineAttachments);

  const internalDate = Number(message.internalDate) || null;
  const dateHeader = headers.date || '';
  const labelIds = Array.isArray(message.labelIds) ? message.labelIds : [];

  return {
    id: message.id,
    threadId: message.threadId,
    labelIds,
    isUnread: labelIds.includes('UNREAD'),
    isStarred: labelIds.includes('STARRED'),
    isDraft: labelIds.includes('DRAFT'),
    isSent: labelIds.includes('SENT'),
    isInbox: labelIds.includes('INBOX'),
    isTrash: labelIds.includes('TRASH'),
    isSpam: labelIds.includes('SPAM'),
    snippet: message.snippet || '',
    internalDate,
    date: internalDate ? new Date(internalDate).toISOString() : dateHeader,
    subject: decodeHeaderValue(headers.subject || ''),
    from: decodeHeaderValue(headers.from || ''),
    to: decodeHeaderValue(headers.to || ''),
    cc: decodeHeaderValue(headers.cc || ''),
    bcc: decodeHeaderValue(headers.bcc || ''),
    replyTo: decodeHeaderValue(headers['reply-to'] || ''),
    rfcMessageId: decodeHeaderValue(headers['message-id'] || ''),
    references: decodeHeaderValue(headers.references || ''),
    inReplyTo: decodeHeaderValue(headers['in-reply-to'] || ''),
    html,
    text,
    attachments: state.attachments,
    inlineAttachments: state.inlineAttachments,
    sizeEstimate: message.sizeEstimate || 0,
  };
}

function payloadHasAttachments(payload) {
  if (!payload) return false;
  if (payload.filename && payload.body && payload.body.attachmentId) return true;
  for (const child of payload.parts || []) {
    if (payloadHasAttachments(child)) return true;
  }
  return false;
}

function threadSummary(thread) {
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const last = messages[messages.length - 1] || {};
  const headers = headerMap(last);
  const unreadCount = messages.filter(m => (m.labelIds || []).includes('UNREAD')).length;
  const isStarred = messages.some(m => (m.labelIds || []).includes('STARRED'));
  const hasAttachments = messages.some(m => payloadHasAttachments(m.payload));
  const internalDate = Number(last.internalDate) || null;

  return {
    id: thread.id,
    threadId: thread.id,
    subject: decodeHeaderValue(headers.subject || '') || '(no subject)',
    from: decodeHeaderValue(headers.from || ''),
    to: decodeHeaderValue(headers.to || ''),
    cc: decodeHeaderValue(headers.cc || ''),
    date: internalDate ? new Date(internalDate).toISOString() : (headers.date || ''),
    snippet: thread.snippet || last.snippet || '',
    messageCount: messages.length,
    unreadCount,
    isUnread: unreadCount > 0,
    isStarred,
    hasAttachments,
    labelIds: Array.from(new Set(messages.flatMap(m => m.labelIds || []))),
    lastMessageId: last.id || '',
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getThreadMetadata(threadId, { force = false } = {}) {
  const key = String(threadId);
  if (!force) {
    const cached = cacheGet(threadMetadataCache, key);
    if (cached) return cached;
  }
  const data = await dedupe(`meta:${key}`, () => withGmailRetry(async () => {
    const { gmail } = getServices();
    const response = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'metadata',
    });
    return response.data;
  }, 'thread metadata'));
  return cacheSet(threadMetadataCache, key, data, CACHE_TTL_MS);
}

async function getThreadSummary(threadId, { force = false } = {}) {
  const key = String(threadId);
  if (!force) {
    const cached = cacheGet(threadSummaryCache, key);
    if (cached) return cached;
  }
  const metadata = await getThreadMetadata(threadId, { force });
  return cacheSet(threadSummaryCache, key, threadSummary(metadata), CACHE_TTL_MS);
}

async function findDraftIdForThread(threadId) {
  const key = String(threadId);
  const cached = cacheGet(draftIdCache, key);
  if (cached !== null) return cached;

  return dedupe(`draft:${key}`, async () => {
    const { gmail } = getServices();
    let pageToken = undefined;
    do {
      const response = await withGmailRetry(() => gmail.users.drafts.list({
        userId: 'me',
        maxResults: 100,
        pageToken,
      }), 'drafts list');
      const drafts = response.data.drafts || [];
      const found = drafts.find(d => d.message && d.message.threadId === threadId);
      if (found) {
        cacheSet(draftIdCache, key, found.id, LIST_CACHE_TTL_MS);
        return found.id;
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);
    cacheSet(draftIdCache, key, '', LIST_CACHE_TTL_MS);
    return null;
  });
}

async function listDraftThreads({ pageToken, limit }) {
  const { gmail } = getServices();
  const response = await withGmailRetry(() => gmail.users.drafts.list({
    userId: 'me',
    maxResults: limit,
    pageToken,
  }), 'drafts list');
  const drafts = response.data.drafts || [];
  const threads = await mapWithConcurrency(drafts, MAX_CONCURRENCY, async (draft) => {
    const threadId = draft.message && draft.message.threadId;
    if (!threadId) return null;
    try {
      const summary = await getThreadSummary(threadId);
      return { ...summary, draftId: draft.id };
    } catch (err) {
      return null;
    }
  });
  return {
    threads: threads.filter(Boolean),
    nextPageToken: response.data.nextPageToken || null,
  };
}

async function listThreads({ folder = 'inbox', q = '', pageToken, limit = DEFAULT_PAGE_SIZE, force = false } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_PAGE_SIZE, 25));
  const cacheKey = `${folder}|${q}|${pageToken || ''}|${safeLimit}`;
  if (!force) {
    const cached = cacheGet(listCache, cacheKey);
    if (cached) return cached;
  }

  return dedupe(`list:${cacheKey}`, async () => {
    let result;
    if (folder === 'drafts') {
      result = await listDraftThreads({ pageToken, limit: safeLimit });
    } else {
      const { gmail } = getServices();
      const baseQuery = FOLDER_QUERIES[folder] || FOLDER_QUERIES.inbox;
      const query = q ? `${baseQuery} ${q}` : baseQuery;

      const response = await withGmailRetry(() => gmail.users.threads.list({
        userId: 'me',
        q: query,
        maxResults: safeLimit,
        pageToken: pageToken || undefined,
      }), 'threads list');

      const rawThreads = response.data.threads || [];
      const threads = await mapWithConcurrency(rawThreads, MAX_CONCURRENCY, async (item) => {
        try {
          return await getThreadSummary(item.id, { force });
        } catch (err) {
          if (isQuotaError(err)) throw err;
          return {
            id: item.id,
            threadId: item.id,
            subject: '(unable to load)',
            snippet: item.snippet || '',
            isUnread: false,
            isStarred: false,
            hasAttachments: false,
            messageCount: 0,
            labelIds: [],
            error: err.message,
            quota: false,
          };
        }
      });

      result = {
        threads,
        nextPageToken: response.data.nextPageToken || null,
      };
    }

    return cacheSet(listCache, cacheKey, result, LIST_CACHE_TTL_MS);
  });
}

async function getThreadDetail(threadId, { force = false } = {}) {
  const key = String(threadId);
  if (!force) {
    const cached = cacheGet(threadDetailCache, key);
    if (cached) return cached;
  }

  return dedupe(`detail:${key}`, async () => {
    const { gmail } = getServices();
    const response = await withGmailRetry(() => gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    }), 'thread detail');
    const thread = response.data;
    const messages = (thread.messages || [])
      .slice()
      .sort((a, b) => (Number(a.internalDate) || 0) - (Number(b.internalDate) || 0))
      .map(parseMessage);

    const summary = threadSummary(thread);
    let draftId = null;
    if (messages.some(m => m.isDraft)) {
      try {
        draftId = await findDraftIdForThread(threadId);
      } catch (err) {
        draftId = null;
      }
    }

    const detail = { ...summary, draftId, messages };
    return cacheSet(threadDetailCache, key, detail, DETAIL_CACHE_TTL_MS);
  });
}

async function getProfile({ force = false } = {}) {
  const now = Date.now();
  if (!force) {
    if (profileCache && now - profileCacheAt < CACHE_TTL_MS) return profileCache;
    if (profileError && now - profileErrorAt < Math.min(LIST_CACHE_TTL_MS, 30000)) {
      throw profileError;
    }
  }

  return dedupe('profile', async () => {
    try {
      const { gmail } = getServices();
      const response = await withGmailRetry(() => gmail.users.getProfile({ userId: 'me' }), 'profile');
      const caps = getCapabilities();
      profileCache = {
        emailAddress: response.data.emailAddress,
        messagesTotal: response.data.messagesTotal,
        threadsTotal: response.data.threadsTotal,
        historyId: response.data.historyId,
        displayName: process.env.MAIL_FROM_NAME || 'Laser Power & Infra',
        ...caps,
      };
      profileCacheAt = Date.now();
      profileError = null;
      profileErrorAt = 0;
      return profileCache;
    } catch (err) {
      profileError = err;
      profileErrorAt = Date.now();
      throw err;
    }
  });
}

async function getCounts({ force = false } = {}) {
  const now = Date.now();
  if (!force && countsCache.data && now - countsCache.at < LIST_CACHE_TTL_MS) {
    return countsCache.data;
  }

  return dedupe('counts', async () => {
    const { gmail } = getServices();
    const labelIds = ['INBOX', 'SPAM', 'TRASH', 'STARRED', 'SENT'];
    const labels = {};
    await withGmailRetry(() => Promise.all(labelIds.map(async (labelId) => {
      const response = await gmail.users.labels.get({ userId: 'me', id: labelId });
      labels[labelId] = {
        total: response.data.threadsTotal || 0,
        unread: response.data.threadsUnread || 0,
      };
    })), 'label counts');

    let drafts = 0;
    try {
      const draftsResponse = await withGmailRetry(
        () => gmail.users.drafts.list({ userId: 'me', maxResults: 1 }),
        'draft count'
      );
      drafts = draftsResponse.data.resultSizeEstimate || 0;
    } catch (err) {
      if (isQuotaError(err)) throw err;
      drafts = 0;
    }

    const counts = {
      inbox: labels.INBOX,
      spam: labels.SPAM,
      trash: labels.TRASH,
      starred: labels.STARRED,
      sent: labels.SENT,
      drafts: { total: drafts, unread: 0 },
    };
    countsCache.data = counts;
    countsCache.at = Date.now();
    return counts;
  });
}

function getActionLabels(action) {
  switch (action) {
    case 'read':
      return { add: [], remove: ['UNREAD'] };
    case 'unread':
      return { add: ['UNREAD'], remove: [] };
    case 'star':
      return { add: ['STARRED'], remove: [] };
    case 'unstar':
      return { add: [], remove: ['STARRED'] };
    case 'archive':
      return { add: [], remove: ['INBOX'] };
    case 'unarchive':
      return { add: ['INBOX'], remove: [] };
    case 'trash':
      return { add: ['TRASH'], remove: ['INBOX', 'SPAM'] };
    case 'untrash':
      return { add: ['INBOX'], remove: ['TRASH', 'SPAM'] };
    case 'spam':
      return { add: ['SPAM'], remove: ['INBOX', 'TRASH'] };
    case 'unspam':
      return { add: ['INBOX'], remove: ['SPAM', 'TRASH'] };
    case 'markImportant':
      return { add: ['IMPORTANT'], remove: [] };
    case 'unmarkImportant':
      return { add: [], remove: ['IMPORTANT'] };
    default:
      throw new Error(`Unknown mailbox action: ${action}`);
  }
}

async function modifyThread(threadId, action) {
  const { gmail } = getServices();
  const labels = getActionLabels(action);
  const cachedSummary = cacheGet(threadSummaryCache, String(threadId));

  await withGmailRetry(() => gmail.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: {
      addLabelIds: labels.add,
      removeLabelIds: labels.remove,
    },
  }), 'modify thread');

  let unreadCount = cachedSummary ? cachedSummary.unreadCount : 0;
  let isStarred = cachedSummary ? cachedSummary.isStarred : false;
  if (action === 'read') unreadCount = 0;
  if (action === 'unread') unreadCount = Math.max(unreadCount, 1);
  if (action === 'star') isStarred = true;
  if (action === 'unstar') isStarred = false;

  clearMailboxCache();
  return {
    threadId,
    action,
    unreadCount,
    isUnread: unreadCount > 0,
    isStarred,
  };
}

async function downloadAttachment(messageId, attachmentId) {
  const { gmail } = getServices();
  const response = await withGmailRetry(() => gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  }), 'attachment download');
  return decodeBase64Url(response.data.data);
}

function parseDriveFileId(link) {
  if (!link) return null;
  const patterns = [
    /\/file\/d\/([^/?#]+)/,
    /[?&]id=([^&#]+)/,
    /\/document\/d\/([^/?#]+)/,
    /\/spreadsheets\/d\/([^/?#]+)/,
  ];
  for (const pattern of patterns) {
    const match = String(link).match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function downloadDriveFile(link) {
  const fileId = parseDriveFileId(link);
  if (!fileId) throw new Error('Could not determine Drive file ID from link.');
  const { drive } = getServices();
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(response.data);
}

async function resolveAttachment(attachment) {
  if (!attachment) return null;
  const name = attachment.name || attachment.filename || 'attachment';
  let content = null;
  let contentType = attachment.mimeType || attachment.contentType || 'application/octet-stream';

  if (attachment.dataBase64) {
    content = Buffer.from(attachment.dataBase64, 'base64');
  } else if (attachment.link) {
    content = await downloadDriveFile(attachment.link);
  } else if (attachment.attachmentId && attachment.messageId) {
    content = await downloadAttachment(attachment.messageId, attachment.attachmentId);
    contentType = attachment.mimeType || contentType;
  }

  if (!content) return null;
  return { filename: name, content, contentType };
}

async function collectOriginalAttachments(thread, maxBytes = 18 * 1024 * 1024) {
  const results = [];
  let total = 0;
  for (const message of thread.messages || []) {
    const parsed = parseMessage(message);
    for (const attachment of parsed.attachments) {
      if (attachment.inline) continue;
      if (!attachment.attachmentId) continue;
      if (attachment.size && total + attachment.size > maxBytes) continue;
      try {
        const content = await downloadAttachment(message.id, attachment.attachmentId);
        if (total + content.length > maxBytes) continue;
        total += content.length;
        results.push({
          filename: attachment.filename,
          content,
          contentType: attachment.mimeType,
        });
      } catch (err) {
        console.warn(`[Gmail] Could not attach ${attachment.filename}:`, err.message);
      }
    }
  }
  return results;
}

async function buildRawMessage(options) {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix',
  });
  const info = await transport.sendMail(options);
  const message = Buffer.isBuffer(info.message) ? info.message : Buffer.from(info.message);
  return message.toString('base64url');
}

async function sendRaw({ raw, threadId }) {
  const { gmail } = getServices();
  const requestBody = { raw };
  if (threadId) requestBody.threadId = threadId;
  const response = await withGmailRetry(() => gmail.users.messages.send({
    userId: 'me',
    requestBody,
  }), 'send message');
  clearMailboxCache();
  return response.data;
}

function extractAddresses(value) {
  return String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function emailOnly(value) {
  const match = String(value || '').match(/<([^>]+)>/);
  return (match ? match[1] : String(value || '')).trim().toLowerCase();
}

function normalizeSubject(subject, prefix) {
  const clean = String(subject || '').trim();
  const regex = new RegExp(`^${prefix}\\s*:`, 'i');
  return regex.test(clean) ? clean : `${prefix}: ${clean || '(no subject)'}`;
}

function buildReferences(message) {
  const existing = String(message.references || '').trim();
  const own = String(message.rfcMessageId || '').trim();
  if (existing && own && !existing.includes(own)) return `${existing} ${own}`;
  if (existing) return existing;
  return own;
}

async function sendEmail({ to, cc, bcc, subject, body, html, attachments = [], threadId, inReplyTo, references } = {}) {
  if (!to) throw new Error('Recipient (to) is required.');
  if (!subject) throw new Error('Subject is required.');

  const profile = await getProfile();
  const from = `"${profile.displayName || 'Laser Power & Infra'}" <${profile.emailAddress}>`;
  const text = String(body || '');
  if (!text.trim() && !html) throw new Error('Email body is required.');

  let finalInReplyTo = inReplyTo || '';
  let finalReferences = references || '';
  if (threadId && (!finalInReplyTo || !finalReferences)) {
    try {
      const { gmail } = getServices();
      const threadResponse = await withGmailRetry(() => gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full',
      }), 'reply headers');
      const threadMessages = (threadResponse.data.messages || []).slice().sort(
        (a, b) => (Number(a.internalDate) || 0) - (Number(b.internalDate) || 0)
      );
      const original = threadMessages[threadMessages.length - 1];
      if (original) {
        const parsed = parseMessage(original);
        finalInReplyTo = finalInReplyTo || parsed.rfcMessageId || '';
        finalReferences = finalReferences || buildReferences(parsed) || '';
      }
    } catch (err) {
      console.warn('[Gmail] Could not load reply headers:', err.message);
    }
  }

  const resolved = [];
  for (const attachment of attachments) {
    try {
      const file = await resolveAttachment(attachment);
      if (file) resolved.push(file);
    } catch (err) {
      console.warn('[Gmail] Attachment skipped:', err.message);
    }
  }

  const options = {
    from,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    subject,
    text,
    html: html || textToHtml(text),
    attachments: resolved,
    inReplyTo: finalInReplyTo || undefined,
    references: finalReferences || undefined,
  };

  const raw = await buildRawMessage(options);
  const sent = await sendRaw({ raw, threadId });
  return {
    success: true,
    messageId: sent.id,
    threadId: sent.threadId,
    mode: 'GMAIL',
    attachmentCount: resolved.length,
  };
}

async function replyToThread(threadId, { to, cc, bcc, body, html, attachments = [], replyAll = false, includeOriginalAttachments = true } = {}) {
  const { gmail } = getServices();
  const response = await withGmailRetry(() => gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  }), 'thread read');
  const thread = response.data;
  const messages = (thread.messages || []).slice().sort(
    (a, b) => (Number(a.internalDate) || 0) - (Number(b.internalDate) || 0)
  );
  const original = messages[messages.length - 1];
  if (!original) throw new Error('Thread has no messages.');

  const parsed = parseMessage(original);
  const profile = await getProfile();
  const ownEmail = emailOnly(profile.emailAddress);

  let recipients = to || parsed.replyTo || parsed.from;
  let ccList = cc || '';
  if (replyAll) {
    const candidates = [
      ...extractAddresses(parsed.to),
      ...extractAddresses(parsed.cc),
    ].filter(addr => emailOnly(addr) !== ownEmail && emailOnly(addr) !== emailOnly(recipients));
    ccList = [ccList, ...candidates].filter(Boolean).join(', ');
  }

  let finalBody = String(body || '');
  if (!finalBody.trim() && parsed.text) finalBody = '';

  const originalAttachments = includeOriginalAttachments
    ? await collectOriginalAttachments(thread)
    : [];

  const rfcInReplyTo = parsed.rfcMessageId || '';
  const rfcReferences = buildReferences(parsed);

  return sendEmail({
    to: recipients,
    cc: ccList,
    bcc,
    subject: normalizeSubject(parsed.subject, 'Re'),
    body: finalBody,
    html,
    attachments: [...attachments, ...originalAttachments.map(a => ({
      name: a.filename,
      mimeType: a.contentType,
      dataBase64: a.content.toString('base64'),
    }))],
    threadId,
    inReplyTo: rfcInReplyTo,
    references: rfcReferences,
  });
}

async function forwardThread(threadId, { to, cc, bcc, body, html, attachments = [], includeOriginalAttachments = true } = {}) {
  const { gmail } = getServices();
  const response = await withGmailRetry(() => gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  }), 'thread read');
  const thread = response.data;
  const messages = (thread.messages || []).slice().sort(
    (a, b) => (Number(a.internalDate) || 0) - (Number(b.internalDate) || 0)
  );
  const original = messages[messages.length - 1];
  if (!original) throw new Error('Thread has no messages.');
  const parsed = parseMessage(original);

  const headerBlock = [
    '---------- Forwarded message ---------',
    `From: ${parsed.from}`,
    `Date: ${parsed.date}`,
    `Subject: ${parsed.subject}`,
    `To: ${parsed.to}`,
    parsed.cc ? `Cc: ${parsed.cc}` : '',
    '',
    parsed.text || htmlToText(parsed.html),
  ].filter(Boolean).join('\n');

  const finalBody = `${String(body || '').trim()}\n\n${headerBlock}`.trim();
  const originalAttachments = includeOriginalAttachments
    ? await collectOriginalAttachments(thread)
    : [];

  return sendEmail({
    to,
    cc,
    bcc,
    subject: normalizeSubject(parsed.subject, 'Fwd'),
    body: finalBody,
    html: html || textToHtml(finalBody),
    attachments: [...attachments, ...originalAttachments.map(a => ({
      name: a.filename,
      mimeType: a.contentType,
      dataBase64: a.content.toString('base64'),
    }))],
    threadId: null,
  });
}

async function saveDraft({ draftId, to, cc, bcc, subject, body, html, attachments = [], threadId } = {}) {
  const { gmail } = getServices();
  const profile = await getProfile();
  const from = `"${profile.displayName || 'Laser Power & Infra'}" <${profile.emailAddress}>`;
  const text = String(body || '');
  const resolved = [];
  for (const attachment of attachments) {
    try {
      const file = await resolveAttachment(attachment);
      if (file) resolved.push(file);
    } catch (err) {}
  }
  const raw = await buildRawMessage({
    from,
    to: to || undefined,
    cc: cc || undefined,
    bcc: bcc || undefined,
    subject: subject || '(no subject)',
    text,
    html: html || textToHtml(text),
    attachments: resolved,
  });

  const requestBody = { message: { raw } };
  if (threadId) requestBody.message.threadId = threadId;

  if (draftId) {
    const response = await withGmailRetry(() => gmail.users.drafts.update({
      userId: 'me',
      id: draftId,
      requestBody,
    }), 'update draft');
    clearMailboxCache();
    return { success: true, draftId: response.data.id, mode: 'GMAIL' };
  }

  const response = await withGmailRetry(() => gmail.users.drafts.create({
    userId: 'me',
    requestBody,
  }), 'save draft');
  clearMailboxCache();
  return { success: true, draftId: response.data.id, mode: 'GMAIL' };
}

async function sendDraft(draftId) {
  const { gmail } = getServices();
  const response = await withGmailRetry(() => gmail.users.drafts.send({
    userId: 'me',
    requestBody: { id: draftId },
  }), 'send draft');
  clearMailboxCache();
  return {
    success: true,
    messageId: response.data.id,
    threadId: response.data.threadId,
    mode: 'GMAIL',
  };
}

async function deleteDraft(draftId) {
  const { gmail } = getServices();
  await withGmailRetry(() => gmail.users.drafts.delete({ userId: 'me', id: draftId }), 'delete draft');
  clearMailboxCache();
  return { success: true };
}

async function listThreadIdsByQuery(query, { maxPages = 0, delayMs = 1000 } = {}) {
  const { gmail } = getServices();
  const ids = [];
  let pageToken;
  let pages = 0;
  do {
    const response = await withGmailRetry(() => gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: 500,
      pageToken,
    }), 'thread id search');
    const page = response.data.threads || [];
    for (const thread of page) {
      if (thread.id) ids.push(thread.id);
    }
    pageToken = response.data.nextPageToken;
    pages += 1;
    console.log(`[Backfill] ${query}: page ${pages}, ${ids.length} thread IDs.`);
    if (pageToken && delayMs > 0) await sleep(delayMs);
    if (maxPages && pages >= maxPages) break;
  } while (pageToken);
  return ids;
}

async function reconcileThreadStates(threadIds) {
  const unique = Array.from(new Set((threadIds || []).filter(Boolean))).slice(0, 50);
  const states = await mapWithConcurrency(unique, MAX_CONCURRENCY, async (threadId) => {
    try {
      const summary = await getThreadSummary(threadId);
      return {
        threadId,
        unreadCount: summary.unreadCount,
        isUnread: summary.isUnread,
        isStarred: summary.isStarred,
        lastMessageId: summary.lastMessageId,
      };
    } catch (err) {
      return null;
    }
  });
  return states.filter(Boolean);
}

module.exports = {
  FOLDER_QUERIES,
  REQUIRED_SCOPES,
  getGmailAuthClient,
  getDriveAuthClient,
  getAuthClient: getGmailAuthClient,
  getServices,
  getCapabilities,
  getProfile,
  getCounts,
  listThreads,
  getThreadDetail,
  getThreadMetadata,
  modifyThread,
  sendEmail,
  replyToThread,
  forwardThread,
  saveDraft,
  sendDraft,
  deleteDraft,
  downloadAttachment,
  reconcileThreadStates,
  listThreadIdsByQuery,
  clearMailboxCache,
  parseDriveFileId,
};






