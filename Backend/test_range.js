const fs = require('fs');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

(async () => {
  const cache = JSON.parse(fs.readFileSync('./data/sync_cache.json', 'utf-8'));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, ssl: { rejectUnauthorized: false }
  });

  const parseGSheetDate = (dateStr) => {
    if (!dateStr) return null;
    const clean = dateStr.trim();
    let m = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (m) {
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      return new Date(year, Number(m[2]) - 1, Number(m[1]));
    }
    m = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    m = clean.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    const d = new Date(clean);
    return isNaN(d.getTime()) ? null : d;
  };

  const getLocalDateString = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  };

  const [emails] = await conn.execute('SELECT docket_no, tender_no FROM tender_matches');
  let count = 0;
  const start = '2023-10-25';
  emails.forEach(email => {
    const parent = cache.tenders.find(t => t.docketNo === email.docket_no && t.tenderNoRaw === email.tender_no);
    if (parent) {
      const subDate = parseGSheetDate(parent.lastDate);
      if (subDate) {
        const subDateStr = getLocalDateString(subDate);
        if (subDateStr >= start) {
          count++;
        }
      }
    }
  });
  console.log('Tenders on/after 2023-10-25 count:', count);
  await conn.end();
})().catch(e => console.error('ERR:', e.message));
