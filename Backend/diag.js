const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, ssl: { rejectUnauthorized: false }
  });

  const [[maxRow]] = await conn.execute('SELECT MAX(id) as maxId, COUNT(*) as total FROM threads');
  const [[matchRow]] = await conn.execute('SELECT COUNT(*) as matches FROM tender_matches');
  const [[newRow]] = await conn.execute(
    'SELECT COUNT(*) as unmatched FROM threads t LEFT JOIN tender_matches tm ON t.id = tm.thread_db_id WHERE tm.thread_db_id IS NULL AND t.sender NOT LIKE ? AND t.sender NOT LIKE ?',
    ['%protulchatterjee2020@gmail.com%', '%biswajit@omclearing.com%']
  );
  const [[recentRow]] = await conn.execute(
    'SELECT COUNT(*) as recent FROM threads WHERE date >= DATE_SUB(NOW(), INTERVAL 7 DAY)'
  );

  console.log('=== DB Diagnostic ===');
  console.log('Total threads in DB:', maxRow.total);
  console.log('Max thread ID:', maxRow.maxId);
  console.log('Total matches in tender_matches:', matchRow.matches);
  console.log('Threads NOT YET matched:', newRow.unmatched);
  console.log('Threads received in last 7 days:', recentRow.recent);

  await conn.end();
})().catch(e => console.error('ERR:', e.message));
