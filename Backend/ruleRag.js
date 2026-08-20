const { OpenAI } = require('openai');
const { query, getNeonPool, initializeNeonDb } = require('./neonDb');
const dotenv = require('dotenv');
dotenv.config();

const EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_RULES = 5;

function getEmbeddingClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

async function generateEmbedding(text) {
  const client = getEmbeddingClient();
  if (!client) {
    console.warn('[RAG] No OpenAI API key available for embeddings, returning zero vector.');
    return new Array(1536).fill(0);
  }
  const cleaned = text.replace(/[\r\n]+/g, ' ').trim().substring(0, 8000);
  try {
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: cleaned
    });
    return res.data[0].embedding;
  } catch (err) {
    console.warn('[RAG] Embedding generation failed:', err.message);
    return new Array(1536).fill(0);
  }
}

async function storeRule({ ruleText, sourceMatchDbId, sourceDocketNo, sourceTenderNo }) {
  const embedding = await generateEmbedding(ruleText);
  try {
    const result = await query(
      `INSERT INTO matching_rules (rule, embedding, source_match_db_id, source_docket_no, source_tender_no)
       VALUES ($1, $2::vector, $3, $4, $5) RETURNING id`,
      [ruleText, embedding, sourceMatchDbId || null, sourceDocketNo || null, sourceTenderNo || null]
    );
    return result?.rows?.[0]?.id || null;
  } catch (err) {
    console.warn('[RAG] storeRule failed:', err.message);
    return null;
  }
}

async function fetchRelevantRules(contextText) {
  try {
    const embedding = await generateEmbedding(contextText);
    if (!embedding || embedding.every(v => v === 0)) return [];
    const result = await query(
      `SELECT id, rule, source_match_db_id, source_docket_no, source_tender_no, created_at
       FROM matching_rules
       WHERE is_active = true
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [embedding, MAX_RULES]
    );
    return result.rows || [];
  } catch (err) {
    console.warn('[RAG] Rule fetch failed, returning empty:', err.message);
    return [];
  }
}

async function migrateJsonRulesToNeon(jsonRules) {
  const { query: q, getNeonPool } = require('./neonDb');
  try {
    const pool = getNeonPool();
    const existing = await q('SELECT COUNT(*) as count FROM matching_rules');
    if (Number(existing.rows[0].count) > 0) {
      console.log(`[RAG] Neon already has ${existing.rows[0].count} rules, skipping migration.`);
      return;
    }
    if (!jsonRules || jsonRules.length === 0) return;
    console.log(`[RAG] Migrating ${jsonRules.length} rules from JSON to Neon...`);
    for (const rule of jsonRules) {
      const embedding = await generateEmbedding(rule.rule);
      await q(
        `INSERT INTO matching_rules (rule, embedding, source_match_db_id, source_docket_no, source_tender_no)
         VALUES ($1, $2::vector, $3, $4, $5)`,
        [rule.rule, embedding, rule.sourceMatchId || null, rule.sourceDocketNo || null, rule.sourceTenderNo || null]
      );
    }
    console.log('[RAG] Migration complete.');
  } catch (err) {
    console.warn('[RAG] Migration skipped or failed:', err.message);
  }
}

async function deactivateRule(ruleId) {
  await query('UPDATE matching_rules SET is_active = false WHERE id = $1', [ruleId]);
}

module.exports = {
  generateEmbedding,
  storeRule,
  fetchRelevantRules,
  migrateJsonRulesToNeon,
  deactivateRule,
  EMBEDDING_MODEL
};
