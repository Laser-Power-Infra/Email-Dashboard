/**
 * Email -> tender match selection.
 *
 * The old engine linked an email to EVERY tender that had any token hit, so one email
 * (e.g. "Fwd: LASER POWER : SECURITY DEPOSIT 30.06.2026") could be linked to 5 tenders.
 * This module scores every candidate tender for an email and keeps AT MOST ONE:
 *   - only real tender-number / ID evidence counts (tokens extracted from the
 *     "Tender No / NIT No" column; generic words like "LASER POWER" never count),
 *   - tokens shared by several tenders (e.g. a common "PGVCL/PROC/11KV" prefix) are penalised,
 *   - the best candidate must reach MATCH_MIN_SCORE and must clearly beat the runner-up;
 *     if two different tender IDs are equally strong the email is left unmatched (ambiguous).
 */
const {
  extractTenderTokens,
  isBlacklistedToken,
  normalizeText,
  makeTokenRegex
} = require('./matcher');

const MATCH_MIN_SCORE = Number(process.env.MATCH_MIN_SCORE) || 45;

// Location weights: an ID in the subject is far stronger evidence than one buried in an attachment.
const LOCATION_SCORE = { subject: 30, body: 15, ocr: 5 };
const SHARED_TOKEN_PENALTY = 20;   // per additional tender that shares the same token
const EXTRA_TOKEN_BONUS = 10;      // per additional distinct token of the same tender found
const MAX_EXTRA_TOKEN_BONUS = 20;
// A different tender ID scoring within this margin of the best one makes the email ambiguous.
const AMBIGUITY_MARGIN = Number(process.env.MATCH_AMBIGUITY_MARGIN) || 10;

// Words that are never tender-ID evidence on their own (company names, generic tender vocabulary).
const GENERIC_WORDS = new Set([
  'laser', 'power', 'infra', 'infrastructure', 'gmd', 'uic', 'pvt', 'ltd', 'limited', 'private',
  'security', 'deposit', 'tender', 'bid', 'fwd', 'fw', 're', 'emd', 'nit', 'no', 'ref'
]);

const TENDER_CONTEXT_WORDS = [
  'tender', 'bid', 'nit', 'rfp', 'rfi', 'eoi', 'enquiry', 'proposal', 'quotation', 'submission',
  'clarification', 'amendment', 'corrigendum', 'reference', 'contract', 'purchase', 'procurement',
  'auction', 'gem', 'ge-m', 'ref'
];

function alnumLength(token) {
  return (String(token).match(/[a-z0-9]/gi) || []).length;
}

/**
 * Does this token carry real tender-ID evidence?
 * Requires digits, enough length, and not just a company name / generic word plus a short number.
 */
function hasIdEvidence(token) {
  if (!token) return false;
  const t = String(token).trim();
  if (isBlacklistedToken(t)) return false;
  const digits = (t.match(/\d/g) || []).length;
  if (digits < 3) return false;
  if (alnumLength(t) < 5) return false;
  // Pure dates are never IDs (30.06.2026, 30-06-2026, 2026-06-30)
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(t) || /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(t)) return false;
  // "LASER 2026", "POWER-123" style: generic word + short number is not an ID
  const words = t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const letterWords = words.filter(w => /[a-z]/.test(w));
  const longestDigitRun = Math.max(0, ...(t.match(/\d+/g) || []).map(d => d.length));
  if (letterWords.length > 0 && letterWords.every(w => GENERIC_WORDS.has(w)) && longestDigitRun < 5) return false;
  return true;
}

/** Base strength of a token as an identifier (independent of where it was found). */
function tokenStrength(token) {
  const t = String(token);
  let base;
  if (t.includes('/') || (t.match(/_/g) || []).length >= 2 || /^[A-Z]{2,4}\s+\d{2,4}\s+[A-Z]{2,4}$/i.test(t)) {
    base = 40; // self-identifying structured codes: GEM/2026/B/123, 2026_WBSED_553516_1
  } else if (/-/.test(t) && /[a-z]/i.test(t)) {
    base = 35; // dash codes with letters: TPNODL-OT-2026-27-2500001185
  } else if (/[a-z]/i.test(t) && /\d/.test(t)) {
    base = 30; // mixed alnum codes: CC25VJS044
  } else {
    base = 25; // pure numbers (regex already demands a "tender no / ref / id" prefix)
  }
  return base + Math.min(10, Math.floor(alnumLength(t) / 2));
}

function hasTenderContext(text, index, window = 50) {
  const slice = text.slice(Math.max(0, index - window), Math.min(text.length, index + window));
  return TENDER_CONTEXT_WORDS.some(w => slice.includes(w));
}

function isDistinctive(token) {
  return token.includes('/') || (token.match(/_/g) || []).length >= 2 || /^[A-Z]{2,4}\s+\d{2,4}\s+[A-Z]{2,4}$/i.test(token);
}

/**
 * Prepare tenders once per sync: extract + compile tokens and count how many distinct tender
 * numbers share each token.
 * @param {Array<object>} tenders sheet tenders ({ docketNo, tenderNoRaw, isParticipated, rowNumber, ... })
 */
function prepareTendersForMatching(tenders) {
  const tokenOwners = new Map(); // normalised token -> Set(normalised tenderNoRaw)
  const prepared = [];
  for (const tender of tenders || []) {
    if (!tender || !tender.docketNo || !tender.tenderNoRaw) continue;
    const tokens = extractTenderTokens(tender.tenderNoRaw).filter(hasIdEvidence);
    const tenderKey = normalizeText(tender.tenderNoRaw);
    for (const tok of tokens) {
      const k = normalizeText(tok);
      if (!tokenOwners.has(k)) tokenOwners.set(k, new Set());
      tokenOwners.get(k).add(tenderKey);
    }
    prepared.push({
      tender,
      tenderKey,
      compiled: tokens.map(token => ({
        token,
        regex: makeTokenRegex(token),
        // cheap pre-filter: the token's longest digit run must appear in the email text
        digitKey: (token.match(/\d+/g) || []).sort((a, b) => b.length - a.length)[0] || ''
      }))
    });
  }
  const tokenShareCount = new Map();
  for (const [k, owners] of tokenOwners) tokenShareCount.set(k, owners.size);
  return { prepared, tokenShareCount };
}

/**
 * Score one tender against one (pre-normalised) email.
 * @returns {null | { score, matchedToken, confidence, location, matchedTokens }}
 */
function scoreTender(entry, thread, tokenShareCount) {
  const { normSubject = '', normBody = '', normOcr = '' } = thread;
  const hits = [];
  const digitRuns = thread.digitRuns || new Set(`${normSubject} ${normBody} ${normOcr}`.match(/\d+/g) || []);
  for (const { token, regex, digitKey } of entry.compiled) {
    // Token regexes use word boundaries, so a hit implies the exact digit run is present in the text.
    if (digitKey && !digitRuns.has(digitKey)) continue;
    let location = null;
    if (regex.test(normSubject)) {
      location = 'subject';
    } else {
      const bm = regex.exec(normBody);
      if (bm && (isDistinctive(token) || hasTenderContext(normBody, bm.index))) {
        location = 'body';
      } else if (normOcr) {
        const om = regex.exec(normOcr);
        if (om && (isDistinctive(token) || hasTenderContext(normOcr, om.index))) location = 'ocr';
      }
    }
    if (!location) continue;
    const shared = tokenShareCount.get(normalizeText(token)) || 1;
    const score = tokenStrength(token) + LOCATION_SCORE[location] - SHARED_TOKEN_PENALTY * (shared - 1);
    hits.push({ token, location, score, shared });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.score - a.score || alnumLength(b.token) - alnumLength(a.token));
  const best = hits[0];
  const extra = Math.min(MAX_EXTRA_TOKEN_BONUS, EXTRA_TOKEN_BONUS * (hits.length - 1));
  return {
    score: best.score + extra,
    matchedToken: best.token,
    location: best.location,
    confidence: best.location === 'subject' ? 'HIGH' : 'MEDIUM',
    matchedTokens: hits.map(h => h.token)
  };
}

/**
 * Pick at most one tender for an email.
 * @param {{prepared, tokenShareCount}} preparedSet from prepareTendersForMatching
 * @param {{normSubject, normBody, normOcr}} thread pre-normalised email text
 * @param {{minScore?: number}} [opts]
 * @returns {{ best: null | object, candidates: object[], reason: string }}
 */
function findBestTenderForThread(preparedSet, thread, opts = {}) {
  const minScore = opts.minScore != null ? opts.minScore : MATCH_MIN_SCORE;
  const candidates = [];
  const t = {
    ...thread,
    digitRuns: new Set(`${thread.normSubject || ''} ${thread.normBody || ''} ${thread.normOcr || ''}`.match(/\d+/g) || [])
  };
  for (const entry of preparedSet.prepared) {
    const s = scoreTender(entry, t, preparedSet.tokenShareCount);
    if (s) candidates.push({ ...s, tender: entry.tender, tenderKey: entry.tenderKey });
  }
  if (candidates.length === 0) return { best: null, candidates, reason: 'no tender ID found in email' };

  candidates.sort((a, b) =>
    b.score - a.score
    || alnumLength(b.matchedToken) - alnumLength(a.matchedToken)
    || Number(Boolean(b.tender.isParticipated)) - Number(Boolean(a.tender.isParticipated))
    || (Number(b.tender.rowNumber) || 0) - (Number(a.tender.rowNumber) || 0)
  );

  const top = candidates[0];
  if (top.score < minScore) {
    return { best: null, candidates, reason: `best score ${top.score} below threshold ${minScore} (token ${top.matchedToken})` };
  }

  const runnerUp = candidates.find(c => c.tenderKey !== top.tenderKey);
  if (runnerUp && runnerUp.score >= top.score - AMBIGUITY_MARGIN
      && normalizeText(runnerUp.matchedToken) !== normalizeText(top.matchedToken)) {
    // Two DIFFERENT tender IDs with similar evidence (e.g. a deposit statement listing several
    // tenders): refuse to guess rather than link the email to the wrong tender.
    return {
      best: null,
      candidates,
      reason: `ambiguous: ${top.matchedToken} (${top.score}) vs ${runnerUp.matchedToken} (${runnerUp.score})`
    };
  }

  return { best: top, candidates, reason: 'ok' };
}

module.exports = {
  MATCH_MIN_SCORE,
  AMBIGUITY_MARGIN,
  hasIdEvidence,
  tokenStrength,
  prepareTendersForMatching,
  findBestTenderForThread
};
