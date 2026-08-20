require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Connected to DB.');
    const [rows] = await conn.query("SELECT id, subject, sender, date, body, ocr_text FROM threads WHERE body LIKE '%60516%' OR subject LIKE '%60516%' OR ocr_text LIKE '%60516%'");
    console.log(`Found ${rows.length} threads containing 60516.`);
    for (const r of rows) {
      console.log(`Thread ID: ${r.id}, Subject: "${r.subject}"`);
      // check where 60516 occurs
      if (r.body.includes('60516')) {
        console.log('Found in body!');
        const index = r.body.indexOf('60516');
        console.log('Snippet:', r.body.substring(index - 50, index + 50));
      }
      if (r.ocr_text && r.ocr_text.includes('60516')) {
        console.log('Found in OCR!');
      }
    }

    const [rows2] = await conn.query("SELECT id, subject, sender, date, body, ocr_text FROM threads WHERE body LIKE '%TN-26/23-24%' OR subject LIKE '%TN-26/23-24%' OR ocr_text LIKE '%TN-26/23-24%'");
    console.log(`Found ${rows2.length} threads containing TN-26/23-24.`);

  } catch (err) {
    console.error(err);
  } finally {
    await conn.end();
  }
}

main();
