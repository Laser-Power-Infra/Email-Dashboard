#!/usr/bin/env node
/**
 * Re-run email -> tender matching on recent emails with the tightened "one tender per email" rules
 * (tenderMatchSelector.js) and clean up old multi-tender links in tender_matches.
 *
 * DRY-RUN BY DEFAULT: prints what would change and writes nothing.
 *
 * Usage:
 *   node scripts/rematch-recent-emails.js                      # dry-run, last 30 days
 *   node scripts/rematch-recent-emails.js --days=14 --verbose
 *   node scripts/rematch-recent-emails.js --days=30 --apply    # write changes (staging/local DB)
 *   node scripts/rematch-recent-emails.js --apply --allow-production   # only after reviewing a dry-run
 *
 * Options:
 *   --days=N            emails received in the last N days (default 30)
 *   --limit=N           max emails to process (default 5000)
 *   --cache=PATH        tender list (default data/sync_cache.json written by the backend sync)
 *   --min-score=N       override MATCH_MIN_SCORE
 *   --apply             actually update tender_matches (inside a transaction per email)
 *   --allow-production  required together with --apply when DB_HOST is a production host
 *                       (PRODUCTION_DB_HOSTS, default "192.168.1.190")
 *   --verbose           print every email, not only changed ones
 *
 * What --apply does per email:
 *   - deletes tender_matches rows for that email that are not the selected best tender
 *   - inserts the best tender link if it is missing (AI metadata columns are left NULL and get
 *     filled by the next backend sync / "summarize" action)
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

for (const envPath of [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '..', '.env'),
  path.join(process.cwd(), '.env')
]) {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

const { normalizeText } = require('../matcher');
const { prepareTendersForMatching, findBestTenderForThread } = require('../tenderMatchSelector');

function getArg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit === `--${name}`) return true;
  return hit.slice(name.length + 3);
}

const BLACKLISTED_SENDERS = [
  'protulchatterjee2020@gmail.com', 'biswajit@omclearing.com', 'hr@laserpowerinfra.com', 'automation@app.smartsheet.com'
];

async function main() {
  if (getArg('help', false)) {
    console.log(fs.readFileSync(__filename, 'utf-8').split('*/')[0]);
    return;
  }

  const days = Number(getArg('days', 30));
  const limit = Number(getArg('limit', 5000));
  const apply = Boolean(getArg('apply', false));
  const allowProduction = Boolean(getArg('allow-production', false));
  const verbose = Boolean(getArg('verbose', false));
  const minScoreArg = getArg('min-score', null);
  const cachePath = path.resolve(getArg('cache', path.join(__dirname, '..', 'data', 'sync_cache.json')));

  const dbHost = process.env.DB_HOST || 'localhost';
  const productionHosts = (process.env.PRODUCTION_DB_HOSTS || '192.168.1.190').split(',').map(h => h.trim()).filter(Boolean);
  const isProduction = productionHosts.includes(dbHost);
  if (apply && isProduction && !allowProduction) {
    console.error(`Refusing to --apply against production DB host ${dbHost}. Run a dry-run first, then add --allow-production.`);
    process.exit(2);
  }

  if (!fs.existsSync(cachePath)) {
    console.error(`Tender cache not found: ${cachePath}. Run a backend sync first or pass --cache=PATH.`);
    process.exit(1);
  }
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  const tenders = (cache.tenders || []).filter(t => t.docketNo && t.tenderNoRaw);
  const preparedTenders = prepareTendersForMatching(tenders);
  console.log(`Loaded ${tenders.length} tenders from ${cachePath} (synced ${cache.lastSynced || 'unknown'}).`);
  console.log(`DB ${dbHost}/${process.env.DB_NAME || ''} | last ${days} days | limit ${limit} | mode ${apply ? 'APPLY' : 'DRY-RUN'}${isProduction ? ' | PRODUCTION HOST' : ''}`);

  const conn = await mysql.createConnection({
    host: dbHost,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 10000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });

  const table = process.env.DB_TABLE || 'threads';
  const colId = process.env.DB_COL_ID || 'id';
  const colSubject = process.env.DB_COL_SUBJECT || 'subject';
  const colBody = process.env.DB_COL_BODY || 'body';
  const colSender = process.env.DB_COL_SENDER || 'sender';
  const colDate = process.env.DB_COL_DATE || 'date';

  const stats = { emails: 0, unchanged: 0, relinked: 0, unlinked: 0, newlyLinked: 0, rowsDeleted: 0, rowsInserted: 0 };
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [threads] = await conn.query(
      `SELECT ${colId} AS id, thread_id, ${colSubject} AS subject, ${colBody} AS body, ${colSender} AS sender,
              ${colDate} AS date, ocr_text, company
       FROM \`${table}\`
       WHERE ${colDate} >= ?
       ORDER BY ${colDate} DESC
       LIMIT ?`,
      [since, limit]
    );

    for (const thread of threads) {
      const senderLower = String(thread.sender || '').toLowerCase();
      if (BLACKLISTED_SENDERS.some(s => senderLower.includes(s))) continue;
      stats.emails++;

      const { best, reason } = findBestTenderForThread(preparedTenders, {
        normSubject: normalizeText(thread.subject),
        normBody: normalizeText(thread.body),
        normOcr: normalizeText(thread.ocr_text)
      }, minScoreArg != null ? { minScore: Number(minScoreArg) } : {});

      const [existing] = await conn.query(
        'SELECT id, docket_no, tender_no, matched_token FROM tender_matches WHERE thread_db_id = ?',
        [thread.id]
      );
      const bestKey = best ? `${best.tender.docketNo}||${best.tender.tenderNoRaw}` : null;
      const keep = existing.filter(r => `${r.docket_no}||${r.tender_no}` === bestKey);
      const remove = existing.filter(r => `${r.docket_no}||${r.tender_no}` !== bestKey);
      const insert = best && keep.length === 0;

      if (remove.length === 0 && !insert) {
        stats.unchanged++;
        if (verbose) console.log(`= #${thread.id} "${thread.subject}" -> ${bestKey || 'no tender'} (${reason})`);
        continue;
      }

      if (best && existing.length === 0) stats.newlyLinked++;
      else if (!best) stats.unlinked++;
      else stats.relinked++;

      console.log(`\n~ #${thread.id} "${thread.subject}"`);
      for (const r of remove) console.log(`    - remove  ${r.docket_no} | ${r.tender_no} (token ${r.matched_token})`);
      for (const r of keep) console.log(`    = keep    ${r.docket_no} | ${r.tender_no}`);
      if (insert) console.log(`    + link    ${best.tender.docketNo} | ${best.tender.tenderNoRaw} (token ${best.matchedToken}, score ${best.score})`);
      if (!best) console.log(`      reason: ${reason}`);

      if (!apply) continue;
      await conn.beginTransaction();
      try {
        if (remove.length > 0) {
          const [del] = await conn.query('DELETE FROM tender_matches WHERE id IN (?)', [remove.map(r => r.id)]);
          stats.rowsDeleted += del.affectedRows;
        }
        if (insert) {
          const [ins] = await conn.query(
            `INSERT IGNORE INTO tender_matches (docket_no, tender_no, thread_db_id, thread_id, matched_token, confidence, company)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [best.tender.docketNo, best.tender.tenderNoRaw, thread.id, thread.thread_id, best.matchedToken, best.confidence, thread.company || 'laser']
          );
          stats.rowsInserted += ins.affectedRows;
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        console.error(`    ! failed for #${thread.id}: ${err.message}`);
      }
    }
  } finally {
    await conn.end();
  }

  console.log('\nSummary:', JSON.stringify(stats, null, 2));
  if (!apply) console.log('Dry-run only: nothing was written. Re-run with --apply to update tender_matches.');
}

main().catch(err => {
  console.error('Re-match failed:', err.message);
  process.exit(1);
});
