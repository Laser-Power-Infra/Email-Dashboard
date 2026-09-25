const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
const envPaths = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(process.cwd(), '.env'),
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

// PostgreSQL connection pool
let pgPool = null;
function getPgPool() {
  if (!pgPool) {
    const connectionString = process.env.POSTGRES_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error('POSTGRES_CONNECTION_STRING is not defined in .env');
    }
    pgPool = new Pool({ connectionString });
  }
  return pgPool;
}

// MySQL connection pool
let mysqlPool = null;
function getMysqlPool() {
  if (!mysqlPool) {
    mysqlPool = mysql.createPool({
      host: process.env.DB_HOST || '192.168.1.190',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'defaultdb',
      port: Number(process.env.DB_PORT) || 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }
  return mysqlPool;
}

/**
 * Initialize PostgreSQL table and indexes
 */
async function initializePgTable() {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS docket_quotation_threads (
        id SERIAL PRIMARY KEY,
        mysql_thread_id INT,
        thread_id VARCHAR(255) UNIQUE NOT NULL,
        mail_type VARCHAR(50) NOT NULL,
        docket_no VARCHAR(255),
        docket_status VARCHAR(100),
        state VARCHAR(100),
        is_gmd_client BOOLEAN DEFAULT FALSE,
        is_replied BOOLEAN DEFAULT FALSE,
        action_tag VARCHAR(100),
        match_reasons TEXT,
        date TIMESTAMP WITH TIME ZONE,
        sender VARCHAR(500),
        sender_details JSONB,
        to_details JSONB,
        cc_details JSONB,
        subject TEXT,
        body TEXT,
        body_preview TEXT,
        attach_names JSONB,
        attach_links JSONB,
        ocr_text TEXT,
        ai_summary TEXT,
        category VARCHAR(100),
        sub_category VARCHAR(100),
        company VARCHAR(100),
        codeword VARCHAR(100),
        user_labels JSONB,
        msg_count INT DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_dqt_thread_id ON docket_quotation_threads(thread_id);
      CREATE INDEX IF NOT EXISTS idx_dqt_docket_no ON docket_quotation_threads(docket_no);
      CREATE INDEX IF NOT EXISTS idx_dqt_docket_status ON docket_quotation_threads(docket_status);
      CREATE INDEX IF NOT EXISTS idx_dqt_is_gmd_client ON docket_quotation_threads(is_gmd_client);
      CREATE INDEX IF NOT EXISTS idx_dqt_action_tag ON docket_quotation_threads(action_tag);
      CREATE INDEX IF NOT EXISTS idx_dqt_mail_type ON docket_quotation_threads(mail_type);
      CREATE INDEX IF NOT EXISTS idx_dqt_date ON docket_quotation_threads(date DESC);
      CREATE INDEX IF NOT EXISTS idx_dqt_company ON docket_quotation_threads(company);
    `);
    console.log('[PostgreSQL] Table "docket_quotation_threads" & indexes initialized successfully.');
  } finally {
    client.release();
  }
}

/**
 * Filter out useless signature images
 */
function isExcludedAttachment(filename) {
  if (!filename) return false;
  const lower = filename.toLowerCase().trim();
  if (/^image\d*\.(png|jpg|jpeg|gif)$/i.test(lower)) return true;
  if (/^icon\d*\.(png|jpg|jpeg|gif|ico)$/i.test(lower)) return true;
  if (/^logo\d*\.(png|jpg|jpeg|svg)$/i.test(lower)) return true;
  if (/^signature\.(png|jpg|jpeg)$/i.test(lower)) return true;
  if (/^unnamed\.(png|jpg|jpeg|gif)$/i.test(lower)) return true;
  return false;
}

/**
 * Sanitize attachment arrays
 */
function cleanAttachments(namesRaw, linksRaw) {
  let names = [];
  let links = [];

  if (Array.isArray(namesRaw)) {
    names = namesRaw;
  } else if (typeof namesRaw === 'string' && namesRaw.trim()) {
    try {
      names = JSON.parse(namesRaw);
    } catch {
      names = namesRaw.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  if (Array.isArray(linksRaw)) {
    links = linksRaw;
  } else if (typeof linksRaw === 'string' && linksRaw.trim()) {
    try {
      links = JSON.parse(linksRaw);
    } catch {
      links = linksRaw.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  const cleanNames = [];
  const cleanLinks = [];
  for (let i = 0; i < names.length; i++) {
    const fn = names[i];
    if (fn && !isExcludedAttachment(fn)) {
      cleanNames.push(fn);
      cleanLinks.push(links[i] || '');
    }
  }

  return { cleanNames, cleanLinks };
}

function isDateOrInvalid(str) {
  if (!str) return true;
  const s = String(str).trim();
  if (s.length < 3 || s.length > 80) return true;

  // A valid docket or tender number MUST contain at least one digit
  if (!/\d/.test(s)) return true;

  // Common English words or noisy prefixes
  if (/^(date|doc\.date|docdate|doc_date|message|number|ber|closure|required|details|file|draft|tender|docket|quotation|quote|undefined|null|none|n\/a|na|report|for|and|bid|enq|epc|item|party|warm|cover|the|with|from|your|our|against|regarding|supply|order|cable|cables|conductor|conductors)$/i.test(s)) {
    return true;
  }

  // Date patterns: DD/MM/YYYY, YYYY/MM/DD, Month/DD/YYYY, Timestamps
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(s)) return true;
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(s)) return true;
  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[/-]\d+/i.test(s)) return true;
  if (/\d{1,2}:\d{2}(:\d{2})?/.test(s)) return true;
  // Reject long descriptive phrases (e.g. "Name of Work: Supply of...")
  if (s.includes(' ') && s.split(/\s+/).length > 4) return true;
  if (/^(name\s+of\s+work|subject|description)/i.test(s)) return true;

  return false;
}

/**
 * Extract Docket Number from subject, body, or tender match
 */
function extractDocketNumber(subject, body, linkedDocketNo) {
  // If linked docket exists and is valid
  if (linkedDocketNo && !isDateOrInvalid(linkedDocketNo)) {
    return String(linkedDocketNo).trim();
  }

  const sub = subject || '';
  const bod = (body || '').slice(0, 1500);

  // 1. "Create the docket | <Docket / Bid No> | <Authority>"
  const createMatch = sub.match(/Create\s+(?:the|a)\s+docket\s*\|\s*([^|]+)/i);
  if (createMatch && createMatch[1]) {
    let candidate = createMatch[1].trim();
    // GeM Bid inside pipe
    const gem = candidate.match(/(GEM\/\d{4}\/[A-Z]\/\d+)/i);
    if (gem) return gem[1].toUpperCase();

    // State E-procurement ID inside pipe
    const eproc = candidate.match(/(\d{4}_[A-Z0-9]+_\d+_\d+)/i);
    if (eproc) return eproc[1];

    // Tender code in parenthesis / numbering
    const numInLead = candidate.match(/(?:^\d+\.\s*)?([A-Za-z0-9\/\-_.\(\)]+)/);
    if (numInLead) {
      const cleaned = numInLead[1].replace(/^\d+\.\s*/, '').trim();
      if (!isDateOrInvalid(cleaned)) return cleaned;
    }
    if (!isDateOrInvalid(candidate)) return candidate;
  }

  // 2. GeM Bid Number anywhere in Subject or Body
  const gemMatch = (sub + ' ' + bod).match(/\b(GEM\/\d{4}\/[A-Z]\/\d+)\b/i);
  if (gemMatch) return gemMatch[1].toUpperCase();

  // 3. State e-Procurement Portal Tender IDs (e.g. 2026_WBSED_123456_1, 2026_KSEB_864691_1)
  const eprocMatch = (sub + ' ' + bod).match(/\b(\d{4}_[A-Z0-9]+_\d+_\d+)\b/i);
  if (eprocMatch) return eprocMatch[1];

  // 4. Explicit "Tender No: XYZ" / "NIT No: XYZ" / "Docket No: XYZ" / "RFQ No: XYZ"
  const tenderExplicit = (sub + ' ' + bod).match(/\b(?:tender|bid|rfq|nit|docket|dkt|enquiry)[\s._#-]+(?:no|num|number|#)?[\s.:=-]+([A-Za-z0-9\/\-_.\(\)]+)/i);
  if (tenderExplicit && tenderExplicit[1] && !isDateOrInvalid(tenderExplicit[1])) {
    return tenderExplicit[1].trim();
  }

  // 5. Railway 8-digit tender number (e.g. "10265055") when accompanied by tender / railway context
  const railwayMatch = sub.match(/\b([1-9][0-9]{7})\b/);
  if (railwayMatch && /railway|rail|stores|rly|gem|tender|docket/i.test(sub) && !isDateOrInvalid(railwayMatch[1])) {
    return railwayMatch[1];
  }

  // 6. UIC Dockets (e.g. UICE006616, UIC-1234)
  const uicMatch = (sub + ' ' + bod).match(/\b(UICE?\d{5,10})\b/i);
  if (uicMatch && !isDateOrInvalid(uicMatch[1])) {
    return uicMatch[1].toUpperCase();
  }

  return null;
}

/**
 * Keyword-Based Docket Status Derivation (Zero sheet dependency)
 */
function deriveDocketStatus(subject, body) {
  const text = ((subject || '') + ' ' + (body || '')).toLowerCase();

  // Priority 1: Won / Awarded
  if (/(letter of award|\bloa\b|purchase order|\bpo issued\b|contract awarded|won the tender|acceptance of tender|order received|awarded to us)/i.test(text)) {
    return 'AWARDED / WON';
  }

  // Priority 2: Lost / Rejected
  if (/(technically disqualified|technically rejected|bid disqualified|lost to|tender cancelled|tender scrapped|bid annulled|disqualified)/i.test(text)) {
    return 'LOST / REJECTED';
  }

  // Priority 3: Price Bid Opened
  if (/(price bid opened|financial bid opened|commercial bid opened|commercial evaluation|\bl1 bidder\b|\bl-1\b|lowest bidder|lowest evaluated bidder)/i.test(text)) {
    return 'PRICE BID OPENED';
  }

  // Priority 4: Technical Evaluation
  if (/(technical evaluation|technically qualified|technical bid opened|tq clarification|technical query|technical clarification|shortlisted)/i.test(text)) {
    return 'TECHNICAL EVALUATION';
  }

  // Priority 5: Bid Submitted
  if (/(bid submitted|tender submitted|submission confirmation|successfully submitted|bid uploaded|emd paid|emd submitted|bid has been submitted)/i.test(text)) {
    return 'BID SUBMITTED';
  }

  // Priority 6: Corrigendum / Extension
  if (/(corrigendum|due date extension|date extended|tender amendment|addendum|revised schedule|extension of due date)/i.test(text)) {
    return 'CORRIGENDUM';
  }

  // Priority 7: Pre-Bid / Queries
  if (/(pre-bid meeting|pre-bid query|clarification sought|query regarding tender)/i.test(text)) {
    return 'PRE-BID / QUERY';
  }

  // Priority 8: Docket Created / Initiation
  if (/(create the docket|docket created|docket generated|new docket|docket initiation|prepare docket)/i.test(text)) {
    return 'DOCKET CREATED';
  }

  return 'IN PROGRESS';
}

/**
 * Check if thread is Docket Related
 */
function isDocketRelated(subject, body, ocrText, linkedDocketNo) {
  if (linkedDocketNo) return true;
  const text = ((subject || '') + ' ' + (body || '') + ' ' + (ocrText || '')).toLowerCase();
  return /docket|doc[ ._#-]*no|create the docket|tender submission|bid submission/i.test(text);
}

/**
 * Check if thread is Quotation / RFQ Related
 */
function isQuotationRelated(subject, body) {
  const sub = (subject || '').toLowerCase();
  const bod = (body || '').slice(0, 2000).toLowerCase();

  const isQuoteSubject = /(quotation|quote|\brfq\b|enquiry|inquiry|price offer|commercial offer|price schedule|budgetary quote|rate offer|request for quotation|input requires)/i.test(sub);
  const isQuoteBody = /(request for quotation|\brfq\b|please quote|kindly provide your quotation|our lowest rate|price bid|formal quotation|revised quote)/i.test(bod);

  return isQuoteSubject || isQuoteBody;
}

/**
 * Check if thread is GMD Client
 */
function isGmdClient(company, category, sender, toDetails) {
  const comp = (company || '').toLowerCase();
  const cat = (category || '').toLowerCase();
  const snd = (sender || '').toLowerCase();
  const to = JSON.stringify(toDetails || '').toLowerCase();

  if (comp.includes('gmd')) return true;
  if (snd.includes('gmdalui.co.in') || to.includes('gmdalui.co.in')) return true;
  if (comp.includes('outsider') && (cat.includes('client') || cat.includes('dom') || cat.includes('misc'))) {
    if (snd.includes('gmd') || to.includes('gmd')) return true;
  }
  return false;
}

/**
 * Check if thread has outbound reply from internal team
 */
function checkIsReplied(msgCount, sender, body) {
  if (Number(msgCount) > 1) return true;
  const snd = (sender || '').toLowerCase();
  const bod = (body || '').toLowerCase();

  // If sender is our internal domain, this email itself is a reply or sent email
  if (/@(laserpowerinfra\.com|gmdalui\.co\.in|uicwires\.com|lasercables\.com)/i.test(snd)) {
    return true;
  }

  // If body contains standard forward/reply block
  if (/-----original message-----|from:.*@(laserpowerinfra|gmdalui|uicwires)/i.test(bod)) {
    return true;
  }

  return false;
}

function cleanString(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\0/g, '').replace(/\u0000/g, '');
}

/**
 * Process a batch of threads and upsert into PostgreSQL
 */
async function processThreadsBatch(pgClient, threads, linkedDocketMap) {
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let newDocketCount = 0;

  for (const thread of threads) {
    const linkedDocket = linkedDocketMap[thread.id] || null;
    const isDocket = isDocketRelated(thread.subject, thread.body, thread.ocr_text, linkedDocket);
    const isQuote = isQuotationRelated(thread.subject, thread.body);

    if (!isDocket && !isQuote) {
      skippedCount++;
      continue;
    }

    const gmd = isGmdClient(thread.company, thread.category, thread.sender, thread.to_details);
    const replied = checkIsReplied(thread.msg_count, thread.sender, thread.body);
    const extractedDocketNo = extractDocketNumber(thread.subject, thread.body, linkedDocket);

    let mailType = 'DOCKET';
    if (isDocket && isQuote) {
      mailType = 'BOTH';
    } else if (isQuote) {
      mailType = 'QUOTATION';
    }

    let docketStatus = 'IN PROGRESS';
    let actionTag = 'DOCKET_TRACKING';
    const matchReasons = [];

    if (isDocket) {
      docketStatus = deriveDocketStatus(thread.subject, thread.body);
      matchReasons.push(`Docket Keyword: Status [${docketStatus}]`);
      actionTag = (docketStatus === 'DOCKET CREATED' || docketStatus === 'NEW DOCKET') ? 'NEW DOCKET' : 'DOCKET_TRACKING';
    }

    // Special GMD Client Quotation Rule without reply -> NEW DOCKET
    if (isQuote && gmd && !replied) {
      docketStatus = 'NEW DOCKET';
      actionTag = 'NEW DOCKET';
      matchReasons.push('Quotation + GMD Client + No Reply -> Flagged as NEW DOCKET');
      newDocketCount++;
    } else if (isQuote && !isDocket) {
      docketStatus = replied ? 'QUOTATION_ACTIVE' : 'QUOTATION_RECEIVED';
      actionTag = replied ? 'FOLLOW_UP' : 'ACTION_REQUIRED';
      matchReasons.push(`Quotation Enquiry: [${docketStatus}]`);
    }

    const state = docketStatus;
    const { cleanNames, cleanLinks } = cleanAttachments(thread.attach_names, thread.attach_links);

    let bodyPreview = '';
    if (thread.body) {
      bodyPreview = thread.body
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
    }

    // Safe JSON formatting with null byte removal
    const parseJson = (val) => {
      if (!val) return null;
      let cleanVal = val;
      if (typeof cleanVal === 'string') {
        cleanVal = cleanString(cleanVal);
      }
      if (typeof cleanVal === 'object') return JSON.stringify(cleanVal).replace(/\0/g, '');
      try {
        return JSON.stringify(JSON.parse(cleanVal)).replace(/\0/g, '');
      } catch {
        return JSON.stringify({ value: cleanVal }).replace(/\0/g, '');
      }
    };

    const senderDetailsJson = parseJson(thread.sender_details);
    const toDetailsJson = parseJson(thread.to_details);
    const ccDetailsJson = parseJson(thread.cc_details);
    const userLabelsJson = parseJson(thread.user_labels);
    const attachNamesJson = JSON.stringify(cleanNames).replace(/\0/g, '');
    const attachLinksJson = JSON.stringify(cleanLinks).replace(/\0/g, '');

    const upsertSql = `
      INSERT INTO docket_quotation_threads (
        mysql_thread_id, thread_id, mail_type, docket_no, docket_status, state,
        is_gmd_client, is_replied, action_tag, match_reasons, date, sender,
        sender_details, to_details, cc_details, subject, body, body_preview,
        attach_names, attach_links, ocr_text, ai_summary, category, sub_category,
        company, codeword, user_labels, msg_count, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
        $23, $24, $25, $26, $27, $28, NOW()
      )
      ON CONFLICT (thread_id) DO UPDATE SET
        mysql_thread_id = EXCLUDED.mysql_thread_id,
        mail_type       = EXCLUDED.mail_type,
        docket_no       = EXCLUDED.docket_no,
        docket_status   = EXCLUDED.docket_status,
        state           = EXCLUDED.state,
        is_gmd_client   = EXCLUDED.is_gmd_client,
        is_replied      = EXCLUDED.is_replied,
        action_tag      = EXCLUDED.action_tag,
        match_reasons   = EXCLUDED.match_reasons,
        date            = EXCLUDED.date,
        sender          = EXCLUDED.sender,
        sender_details  = EXCLUDED.sender_details,
        to_details      = EXCLUDED.to_details,
        cc_details      = EXCLUDED.cc_details,
        subject         = EXCLUDED.subject,
        body            = EXCLUDED.body,
        body_preview    = EXCLUDED.body_preview,
        attach_names    = EXCLUDED.attach_names,
        attach_links    = EXCLUDED.attach_links,
        ocr_text        = COALESCE(EXCLUDED.ocr_text, docket_quotation_threads.ocr_text),
        ai_summary      = COALESCE(EXCLUDED.ai_summary, docket_quotation_threads.ai_summary),
        category        = EXCLUDED.category,
        sub_category    = EXCLUDED.sub_category,
        company         = EXCLUDED.company,
        codeword        = EXCLUDED.codeword,
        user_labels     = EXCLUDED.user_labels,
        msg_count       = EXCLUDED.msg_count,
        updated_at      = NOW()
      RETURNING (xmax = 0) AS is_insert;
    `;

    const values = [
      thread.id,
      cleanString(thread.thread_id),
      mailType,
      cleanString(extractedDocketNo),
      docketStatus,
      state,
      gmd,
      replied,
      actionTag,
      cleanString(matchReasons.join(' | ')),
      thread.date ? new Date(thread.date) : null,
      cleanString(thread.sender),
      senderDetailsJson,
      toDetailsJson,
      ccDetailsJson,
      cleanString(thread.subject),
      cleanString(thread.body),
      cleanString(bodyPreview),
      attachNamesJson,
      attachLinksJson,
      cleanString(thread.ocr_text) || null,
      cleanString(thread.ai_summary) || null,
      cleanString(thread.category) || null,
      cleanString(thread.sub_category) || null,
      cleanString(thread.company) || 'Outsider',
      cleanString(thread.codeword) || null,
      userLabelsJson,
      thread.msg_count || 1
    ];

    try {
      const res = await pgPool.query(upsertSql, values);
      if (res.rows[0]?.is_insert) {
        insertedCount++;
      } else {
        updatedCount++;
      }
    } catch (err) {
      console.warn(`[Sync Error] Thread ID ${thread.thread_id}:`, err.message);
    }
  }

  return { insertedCount, updatedCount, skippedCount, newDocketCount };
}

/**
 * Execute Full / Incremental Sync from MySQL to PostgreSQL
 */
async function syncDocketQuotationMails({ batchSize = 500, maxRows = null, sinceId = null, recentLimit = null } = {}) {
  console.log('\n======================================================');
  console.log('  STARTING DOCKET & QUOTATION POSTGRESQL SYNC');
  console.log('======================================================');

  await initializePgTable();

  const mysqlPool = getMysqlPool();
  const pgPool = getPgPool();

  let totalProcessed = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalNewDocket = 0;

  try {
    // 1. Preload linked docket numbers from tender_matches
    console.log('[1/3] Loading tender_matches docket mappings from MySQL...');
    const [matchRows] = await mysqlPool.query(
      `SELECT thread_db_id, docket_no FROM tender_matches WHERE docket_no IS NOT NULL AND docket_no != ''`
    );
    const linkedDocketMap = {};
    for (const r of matchRows) {
      if (r.thread_db_id && r.docket_no) {
        linkedDocketMap[r.thread_db_id] = r.docket_no;
      }
    }
    console.log(`Loaded ${Object.keys(linkedDocketMap).length} linked docket mapping records.`);

    const tableName = process.env.DB_TABLE || 'threads';

    // If recentLimit is specified, just fetch the most recent N threads for fast real-time sync
    if (recentLimit && recentLimit > 0) {
      console.log(`[2/3] Rapid sync mode: Checking latest ${recentLimit} threads...`);
      const [recentThreads] = await mysqlPool.query(
        `SELECT id, thread_id, msg_count, date, sender, sender_details, cc_details, to_details,
                subject, body, attach_names, attach_links, ocr_text, ai_summary,
                category, sub_category, company, codeword, user_labels
         FROM \`${tableName}\`
         ORDER BY id DESC
         LIMIT ?`,
        [recentLimit]
      );
      const stats = await processThreadsBatch(pgPool, recentThreads, linkedDocketMap);
      console.log(`[Rapid Sync] Processed: ${recentThreads.length} | Synced to Postgres: ${stats.insertedCount + stats.updatedCount} (New: ${stats.insertedCount}, Updated: ${stats.updatedCount}, New Docket Tags: ${stats.newDocketCount})`);
      return stats;
    }

    // 2. Fetch total threads count
    let countSql = `SELECT COUNT(*) as totalThreads FROM \`${tableName}\``;
    const countParams = [];
    if (sinceId) {
      countSql += ` WHERE id >= ?`;
      countParams.push(sinceId);
    }
    const [[{ totalThreads }]] = await mysqlPool.query(countSql, countParams);
    console.log(`[2/3] Total threads in MySQL to evaluate: ${totalThreads}`);

    // 3. Process in batches
    let offset = 0;
    const limit = batchSize;

    while (true) {
      let batchSql = `SELECT id, thread_id, msg_count, date, sender, sender_details, cc_details, to_details,
                             subject, body, attach_names, attach_links, ocr_text, ai_summary,
                             category, sub_category, company, codeword, user_labels
                      FROM \`${tableName}\``;
      const batchParams = [];
      if (sinceId) {
        batchSql += ` WHERE id >= ?`;
        batchParams.push(sinceId);
      }
      batchSql += ` ORDER BY id ASC LIMIT ? OFFSET ?`;
      batchParams.push(limit, offset);

      const [threads] = await mysqlPool.query(batchSql, batchParams);
      if (threads.length === 0) break;

      const stats = await processThreadsBatch(pgPool, threads, linkedDocketMap);
      totalProcessed += threads.length;
      totalInserted += stats.insertedCount;
      totalUpdated += stats.updatedCount;
      totalSkipped += stats.skippedCount;
      totalNewDocket += stats.newDocketCount;

      offset += threads.length;
      console.log(`[Progress] Processed: ${totalProcessed}/${totalThreads} | Synced to Postgres: ${totalInserted + totalUpdated} (New: ${totalInserted}, Updated: ${totalUpdated}, New Docket Tags: ${totalNewDocket}) | Skipped: ${totalSkipped}`);

      if (maxRows && totalProcessed >= maxRows) break;
    }

    // 4. Verification queries on PostgreSQL
    console.log('\n[3/3] Running PostgreSQL Verification & Audit Queries...');
    const countRes = await pgPool.query('SELECT COUNT(*) as total, mail_type FROM docket_quotation_threads GROUP BY mail_type');
    console.log('\n--- POSTGRESQL SYNCED MAIL TYPES ---');
    countRes.rows.forEach(r => console.log(`- ${r.mail_type}: ${r.total}`));

    const statusRes = await pgPool.query('SELECT docket_status, COUNT(*) as cnt FROM docket_quotation_threads GROUP BY docket_status ORDER BY cnt DESC LIMIT 15');
    console.log('\n--- TOP DOCKET STATUSES IN POSTGRESQL ---');
    statusRes.rows.forEach(r => console.log(`- ${r.docket_status}: ${r.cnt}`));

    const gmdRes = await pgPool.query('SELECT is_gmd_client, action_tag, COUNT(*) as cnt FROM docket_quotation_threads GROUP BY is_gmd_client, action_tag');
    console.log('\n--- GMD CLIENT & ACTION TAG DISTRIBUTION ---');
    gmdRes.rows.forEach(r => console.log(`- GMD Client [${r.is_gmd_client}] | Action: [${r.action_tag}] -> ${r.cnt}`));

    console.log('\n======================================================');
    console.log('  SYNC COMPLETED SUCCESSFULLY!');
    console.log(`  Total MySQL Rows Scanned: ${totalProcessed}`);
    console.log(`  Total Synced to Postgres: ${totalInserted + totalUpdated}`);
    console.log(`  Total Skipped (Non-Docket/Quote): ${totalSkipped}`);
    console.log('======================================================\n');

  } catch (err) {
    console.error('Error during syncDocketQuotationMails:', err);
    throw err;
  }
}

// Allow direct CLI execution
if (require.main === module) {
  syncDocketQuotationMails()
    .then(() => {
      console.log('Exiting cleanly.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal Sync Error:', err);
      process.exit(1);
    });
}

module.exports = {
  syncDocketQuotationMails,
  isDocketRelated,
  isQuotationRelated,
  extractDocketNumber,
  deriveDocketStatus,
  isGmdClient,
  checkIsReplied
};
