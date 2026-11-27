'use strict';
// Enquiry mails for the Enquiry to Quotation dashboard (laser-tender), which creates draft enquiries from them.
//
//   GET /api/db-emails/enquiries                      enquiry mails of Laser that changed in the last 3 days
//   GET /api/db-emails/enquiries?since=<next_since>   only what changed after the previous call (poll with this)
//   GET /api/db-emails/enquiries?threadId=1a21...     one thread, whatever it is
//
// By default only enquiries are returned: company Laser, started by an outside party (or forwarded in by a colleague), enquiry wording in the
// subject or an attachment name, and not an order / inspection / payment mail. To widen it:
//   company=Laser,Outsider (or all)   "Outsider" = no group-company address is visible on the mail (the enquiry mailbox was in BCC)
//   strict=0                          also threads where the enquiry wording is only in the mail text (mostly noise)
//   direction=all                     also threads we started (our own offers)
//   all=1                             every thread, no enquiry filter (to check nothing is missed)
// Other parameters: days=3 (1-90, first call only), ocr=0 (leave out attachment text), limit=300 (rows scanned per call).
//
// Read-only. Unlike the older /api/db-emails routes it needs a key: header "x-api-key" (or "Authorization: Bearer ...")
// equal to ENQUIRY_FEED_API_KEY. With no key configured the route answers 503 rather than serve mail text openly.
//
// A row is a whole Gmail thread and is updated in place when a reply arrives, so the caller must keep threads by thread_id.
// All times are returned exactly as stored: Indian Standard Time, "YYYY-MM-DD HH:MM:SS".
const crypto = require('crypto');
const { isQuotationRelated } = require('./docketQuotationSync');

const SEPARATOR = /^--- Message \d+ From: (.*) ---$/gm;   // written by Emails_agent between the messages of a thread, oldest first
const emailOf = (from) => ((String(from).match(/<([^<>\s]+@[^<>\s]+)>/) || String(from).match(/([^\s<>"]+@[^\s<>"]+)/) || [])[1] || '').toLowerCase();
const domainOf = (from) => emailOf(from).split('@')[1] || '';

// Strict enquiry filter, on top of isQuotationRelated (shared with the docket/quotation sync, so not changed here).
// Subjects that ask for a price but miss its word list, e.g. "Requirement – ACSR Wolf Conductor 3000 Mtr", "Rates required of items ...".
const ALSO_ENQUIRY_SUBJECT = /\b(requirement|rates? required)\b/i;
// Not an enquiry even when the wording matches: orders, inspection, payment and dispatch mails; valves are GMD's product, not Laser's.
const NOT_ENQUIRY_SUBJECT = /(purchase order|work order|\bP\.?O\.?\s*(no|number)\b|\bLOA\b|\bLOI\b|inspection|invoice|payment|dispatch|\bvalves?\b)/i;
const AUTOMATED_SENDER = /(automation@app\.smartsheet\.com|no-?reply|donotreply|mailer-daemon|tenderalerts)/i;

/** Keep the start (the enquiry itself) and the end (the latest reply) of a long text. */
function trim(text, head, tail) {
  const s = String(text || '');
  if (s.length <= head + tail) return s;
  return `${s.slice(0, head)}\n[... ${s.length - head - tail} characters left out ...]\n${s.slice(-tail)}`;
}

/**
 * Pure: turn stored thread rows into feed items and apply the filters that are not done in SQL.
 * kind = 'incoming'  the first message came from outside the group companies
 *        'forwarded' the first message is internal but the subject is a forward (a colleague passing an enquiry on)
 *        'outgoing'  started by us (our own offers, our RFQs to suppliers)
 */
function selectEnquiryThreads(rows, opts = {}) {
  const internal = new Set((opts.internalDomains || []).map(d => d.toLowerCase()));
  const clean = opts.sanitize || (x => x);
  const out = [];
  for (const row of rows) {
    const body = String(row.body || '');
    const froms = [...body.matchAll(SEPARATOR)].map(m => m[1].trim());
    const firstFrom = froms[0] || row.sender || '';
    const startedInside = internal.has(domainOf(firstFrom));
    const kind = !startedInside ? 'incoming' : /^\s*(fw|fwd)\s*:/i.test(row.subject || '') ? 'forwarded' : 'outgoing';
    if (!opts.single) {
      if (opts.direction !== 'all' && kind === 'outgoing') continue;
      if (!opts.all && !isQuotationRelated(row.subject, body, row.attach_names, row.user_labels) && !ALSO_ENQUIRY_SUBJECT.test(row.subject || '')) continue;
    }
    const matchedOn = [['subject', [row.subject, '', '', '']], ['attachment', ['', '', row.attach_names, '']], ['label', ['', '', '', row.user_labels]], ['body', ['', body, '', '']]]
      .filter(([where, args]) => isQuotationRelated(...args) || (where === 'subject' && ALSO_ENQUIRY_SUBJECT.test(row.subject || ''))).map(([where]) => where);
    if (!opts.single && !opts.all && opts.strict !== false) {
      if (!matchedOn.includes('subject') && !matchedOn.includes('attachment')) continue;
      if (NOT_ENQUIRY_SUBJECT.test(row.subject || '') || AUTOMATED_SENDER.test(firstFrom)) continue;
    }
    const att = clean({ attach_names: row.attach_names, attach_links: row.attach_links });
    out.push({
      thread_id: row.thread_id,
      kind,
      // where the enquiry wording was found; a match on 'body' alone is the weakest (a long thread mentions "offer for" easily)
      matched_on: matchedOn,
      date: row.date,                       // latest message of the thread
      last_updated: row.last_updated,
      first_from: firstFrom,                // who started the thread: the party, for an incoming enquiry
      first_from_email: emailOf(firstFrom),
      latest_from: row.sender,
      message_froms: froms,                 // one per message, oldest first
      to_details: row.to_details,
      cc_details: row.cc_details,
      subject: row.subject,
      company: row.company,
      category: row.category,
      sub_category: row.sub_category,
      user_labels: row.user_labels,
      msg_count: row.msg_count,
      attach_names: att.attach_names,       // comma-joined, paired by position with attach_links (as in /api/db-emails)
      attach_links: att.attach_links,
      body: trim(body, 20000, 8000),
      ...(opts.ocr === false ? {} : { ocr_text: trim(row.ocr_text, 30000, 0) }),
    });
  }
  return out;
}

const sameKey = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Express handler. deps: getDbConnection, releaseDbConnection, sanitizeEmailAttachments, internalDomains. */
function createEnquiryFeedHandler(deps) {
  return async (req, res) => {
    const key = process.env.ENQUIRY_FEED_API_KEY;
    if (!key) return res.status(503).json({ success: false, error: 'Enquiry feed is not configured: set ENQUIRY_FEED_API_KEY' });
    const given = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!given || !sameKey(given, key)) return res.status(401).json({ success: false, error: 'Invalid or missing API key' });

    const LIVE_DB = process.env.DB_NAME || 'defaultdb';
    if (!/^[A-Za-z0-9_]+$/.test(LIVE_DB)) return res.status(500).json({ success: false, error: 'Invalid database name configuration' });
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 300));
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 3));
    const threadId = String(req.query.threadId || '').trim();
    const since = String(req.query.since || '').trim();
    const companies = String(req.query.company || 'Laser').split(',').map(s => s.trim()).filter(Boolean);

    const conditions = [];
    const params = [];
    if (threadId) {
      if (!/^[0-9a-zA-Z_-]{6,64}$/.test(threadId)) return res.status(400).json({ success: false, error: 'Invalid threadId' });
      conditions.push('t.thread_id = ?');
      params.push(threadId);
    } else {
      if (since) {
        // next_since of the previous answer: "<last_updated>|<id>"
        const m = since.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\|(\d+)$/);
        if (!m) return res.status(400).json({ success: false, error: 'Invalid since: pass the next_since value of the previous answer' });
        conditions.push('(t.last_updated > ? OR (t.last_updated = ? AND t.id > ?))');
        params.push(m[1], m[1], Number(m[2]));
      } else {
        conditions.push('t.last_updated >= NOW() - INTERVAL ? DAY');
        params.push(days);
      }
      if (!companies.some(c => c.toLowerCase() === 'all')) {
        conditions.push(`t.company IN (${companies.map(() => '?').join(', ')})`);
        params.push(...companies);
      }
      conditions.push(`t.sender NOT LIKE '%hr@laserpowerinfra.com%'`);
    }

    let conn;
    try {
      conn = await deps.getDbConnection();
      // Two steps: last_updated has no index, so sorting the wide rows (with their mail text) took about 15 s.
      // Picking the ids from the narrow columns first, then reading those rows by primary key, keeps it fast.
      const [picked] = await conn.query(
        `SELECT t.id FROM \`${LIVE_DB}\`.threads t WHERE ${conditions.join(' AND ')} ORDER BY t.last_updated ASC, t.id ASC LIMIT ?`,
        [...params, limit]
      );
      const [rows] = picked.length ? await conn.query(
        `SELECT t.id, t.thread_id, DATE_FORMAT(t.date, '%Y-%m-%d %H:%i:%s') AS date, DATE_FORMAT(t.last_updated, '%Y-%m-%d %H:%i:%s') AS last_updated,
                t.sender, t.to_details, t.cc_details, t.subject, t.company, t.category, t.sub_category, t.user_labels, t.msg_count,
                t.attach_names, t.attach_links, t.body, ${req.query.ocr === '0' ? `'' AS ocr_text` : 'LEFT(t.ocr_text, 30000) AS ocr_text'}
         FROM \`${LIVE_DB}\`.threads t WHERE t.id IN (?) ORDER BY t.last_updated ASC, t.id ASC`,
        [picked.map(r => r.id)]
      ) : [[]];
      const threads = selectEnquiryThreads(rows, {
        internalDomains: deps.internalDomains, sanitize: deps.sanitizeEmailAttachments, single: !!threadId,
        direction: req.query.direction === 'all' ? 'all' : 'incoming', all: req.query.all === '1', strict: req.query.strict !== '0', ocr: req.query.ocr !== '0',
      });
      const last = rows[rows.length - 1];
      res.json({
        success: true,
        scanned: rows.length,                 // threads looked at; `count` of them passed the filters
        count: threads.length,
        more: !threadId && rows.length === limit,   // true: call again with next_since straight away
        next_since: threadId ? null : last ? `${last.last_updated}|${last.id}` : since || null,
        timezone: 'Asia/Kolkata',
        threads,
      });
    } catch (error) {
      console.error('[db-emails/enquiries] Error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    } finally {
      if (conn) deps.releaseDbConnection(conn);
    }
  };
}

module.exports = { createEnquiryFeedHandler, selectEnquiryThreads };
