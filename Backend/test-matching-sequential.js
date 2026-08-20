const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const {
  extractTenderTokens,
  makeTokenRegex,
  makeStrictRegex,
  checkMatchCompiled,
  strictCheckMatchCompiled,
  normalizeText
} = require('./matcher');

const BLACKLISTED_SENDERS = [
  'protulchatterjee2020@gmail.com',
  'biswajit@omclearing.com',
  'automation@app.smartsheet.com',
  'hr@laserpowerinfra.com'
];

function quickCheck(parts, normSubject, normBody, normOcr) {
  if (parts.length === 0) return true;
  const checkText = (text) => parts.every(part => text.includes(part));
  return checkText(normSubject) || checkText(normBody) || (normOcr && checkText(normOcr));
}

async function runTest() {
  console.log("Connecting to local database...");
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Minmoy@1234@',
    database: process.env.DB_NAME || 'defaultdb',
    port: Number(process.env.DB_PORT || 3306)
  });

  console.log("Fetching threads...");
  const [threads] = await conn.execute("SELECT id, thread_id, subject, body, sender, date, ai_summary, ocr_text FROM threads LIMIT 1000");
  console.log(`Fetched ${threads.length} threads.`);

  console.log("Pre-normalizing threads...");
  const normalizedThreads = threads.map(t => ({
    id: t.id,
    thread_id: t.thread_id,
    sender: t.sender,
    date: t.date,
    ai_summary: t.ai_summary,
    normSubject: normalizeText(t.subject),
    normBody: normalizeText(t.body),
    normOcr: normalizeText(t.ocr_text)
  }));

  // Read tenders cache
  const cache = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/sync_cache.json'), 'utf8'));
  const allTenders = cache.tenders.slice(0, 1000);
  console.log(`Using ${allTenders.length} tenders.`);

  console.log("Pre-compiling token regexes and splitting parts...");
  allTenders.forEach(tender => {
    const tokens = extractTenderTokens(tender.tenderNoRaw);
    const regexFn = tender.isParticipated ? makeStrictRegex : makeTokenRegex;
    tender.compiledRegexes = tokens.map(token => {
      const parts = token.toLowerCase().split(/[^a-z0-9]+/i).filter(p => p.length >= 2);
      return {
        token,
        parts,
        regex: regexFn(token)
      };
    });
  });

  console.log("Running matching loop sequentially with pre-split pre-filter...");
  const start = Date.now();
  const matches = [];

  for (let i = 0; i < allTenders.length; i++) {
    const tender = allTenders[i];
    if (!tender.compiledRegexes || tender.compiledRegexes.length === 0) continue;
    const matchFn = tender.isParticipated ? strictCheckMatchCompiled : checkMatchCompiled;

    for (const thread of normalizedThreads) {
      const senderLower = (thread.sender || '').toLowerCase();
      if (BLACKLISTED_SENDERS.some(bl => senderLower.includes(bl))) continue;

      // Check pre-split parts directly without split overhead
      const eligibleRegexes = tender.compiledRegexes.filter(item => 
        quickCheck(item.parts, thread.normSubject, thread.normBody, thread.normOcr)
      );

      if (eligibleRegexes.length === 0) continue;

      const matchResult = matchFn(
        eligibleRegexes,
        thread.normSubject,
        thread.normBody,
        thread.normOcr
      );

      if (matchResult.matched) {
        matches.push(matchResult);
      }
    }
  }

  const duration = Date.now() - start;
  console.log(`Matching complete. Found ${matches.length} matches in ${duration}ms (${duration / 1000} seconds).`);
  await conn.end();
}

runTest().catch(console.error);
