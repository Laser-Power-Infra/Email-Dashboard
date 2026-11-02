#!/usr/bin/env node
/**
 * Backfill Gmail unread/starred state into the local threads table.
 *
 * This version is deliberately cheap: it uses Gmail search queries
 * (`is:unread`, `is:starred`) and a few hundred threads.list calls instead of
 * one threads.get call per database row.
 *
 * Usage:
 *   node scripts/backfill-read-status.js
 *   node scripts/backfill-read-status.js --dry-run
 *   node scripts/backfill-read-status.js --max-pages=20 --delay-ms=2000
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const envCandidates = [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '..', '.env'),
  path.join(process.cwd(), '.env'),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

const gmailMailbox = require('../gmailMailbox');

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchIdsWithRetry(query, options) {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await gmailMailbox.listThreadIdsByQuery(query, options);
    } catch (err) {
      const retryAfter = Number(err.retryAfter) || 60;
      if (attempt >= maxRetries || (err.statusCode !== 429 && err.code !== 'GMAIL_QUOTA')) {
        throw err;
      }
      console.warn(`[Backfill] Quota hit for "${query}". Waiting ${retryAfter}s before retry ${attempt + 1}/${maxRetries}...`);
      await sleep(retryAfter * 1000);
    }
  }
  return [];
}

async function main() {
  const table = process.env.DB_TABLE || 'threads';
  const dryRun = hasFlag('dry-run');
  const maxPages = Number(getArg('max-pages', 0)) || 0;
  const delayMs = Number(getArg('delay-ms', 1500));
  const updateChunkSize = Math.max(50, Math.min(Number(getArg('update-chunk-size', 500)) || 500, 1000));

  console.log(`[Backfill] Table: ${table} | dryRun=${dryRun} | maxPages=${maxPages} | delayMs=${delayMs}`);

  const unreadIds = await fetchIdsWithRetry('is:unread in:anywhere', { maxPages, delayMs });
  const starredIds = await fetchIdsWithRetry('is:starred in:anywhere', { maxPages, delayMs });

  console.log(`[Backfill] Gmail returned ${unreadIds.length} unread threads and ${starredIds.length} starred threads.`);

  if (dryRun) {
    console.log('[Backfill] Dry run: no database changes made.');
    return;
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
  });

  try {
    console.log('[Backfill] Resetting local read/star flags...');
    await pool.query(`UPDATE \`${table}\` SET is_unread = 0, unread_count = 0, is_starred = 0`);

    const unreadChunks = chunk(unreadIds, updateChunkSize);
    let unreadUpdated = 0;
    for (let i = 0; i < unreadChunks.length; i += 1) {
      const ids = unreadChunks[i];
      const placeholders = ids.map(() => '?').join(',');
      const [result] = await pool.query(
        `UPDATE \`${table}\` SET is_unread = 1, unread_count = 1 WHERE thread_id IN (${placeholders})`,
        ids
      );
      unreadUpdated += result.affectedRows || 0;
      console.log(`[Backfill] Unread chunk ${i + 1}/${unreadChunks.length}: ${result.affectedRows || 0} rows.`);
    }

    const starredChunks = chunk(starredIds, updateChunkSize);
    let starredUpdated = 0;
    for (let i = 0; i < starredChunks.length; i += 1) {
      const ids = starredChunks[i];
      const placeholders = ids.map(() => '?').join(',');
      const [result] = await pool.query(
        `UPDATE \`${table}\` SET is_starred = 1 WHERE thread_id IN (${placeholders})`,
        ids
      );
      starredUpdated += result.affectedRows || 0;
      console.log(`[Backfill] Starred chunk ${i + 1}/${starredChunks.length}: ${result.affectedRows || 0} rows.`);
    }

    console.log(`[Backfill] Complete. Unread rows updated: ${unreadUpdated}; starred rows updated: ${starredUpdated}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[Backfill] Failed:', err.message || err);
  process.exitCode = 1;
});
