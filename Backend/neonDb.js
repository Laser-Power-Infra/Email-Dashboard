const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

let pool = null;

function getNeonPool() {
  if (pool) return pool;
  const connectionString = process.env.POSTGRES_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('POSTGRES_CONNECTION_STRING not set in .env');
  }
  pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return pool;
}

async function initializeNeonDb() {
  const p = getNeonPool();
  const client = await p.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query(`
      CREATE TABLE IF NOT EXISTS matching_rules (
        id SERIAL PRIMARY KEY,
        rule TEXT NOT NULL,
        embedding vector(1536),
        source_match_db_id INT,
        source_docket_no VARCHAR(255),
        source_tender_no VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rules_embedding
      ON matching_rules
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);
    console.log('[Neon DB] matching_rules table initialized with pgvector.');
  } catch (err) {
    console.warn('[Neon DB] Init warning:', err.message);
  } finally {
    client.release();
  }
  return p;
}

async function query(text, params = []) {
  const p = getNeonPool();
  return p.query(text, params);
}

async function closeNeon() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getNeonPool, initializeNeonDb, query, closeNeon };
