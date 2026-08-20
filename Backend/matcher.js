/**
 * Matcher utility for extracting tender ID tokens and matching them against email content.
 */

/**
 * Extracts potential tender ID tokens from a raw tender string.
 * @param {string} rawString The raw "Tender No / NIT No with Date" column value.
 * @returns {string[]} An array of unique, cleaned tokens.
 */
const TOKEN_BLACKLIST = new Set([
  'cable', 'cables', 'conductor', 'conductors', 'transformer', 'transformers', 
  'supply', 'supplies', 'spares', 'spare', 'work', 'works', 'report', 'reports', 
  'alert', 'alerts', 'logistics', 'payment', 'payments', 'invoice', 'invoices', 
  'bill', 'bills', 'advice', 'advices', 'smartsheet', 'sheet', 'notification',
  'notifications', 'dated', 'date', 'tender', 'tenders', 'reference', 'number',
  'sub', 'submission', 'offer', 'enquiry', 'specification', 'specifications',
  'ltd', 'limited', 'pvt', 'private', 'corp', 'corporation', 'co', 'company',
  'amendment', 'corrigendum', 'clarification', 'notice', 'document', 'attachment',
  'file', 'details', 'summary', 'status', 'general', 'internal', 'external'
]);

function isBlacklistedToken(token) {
  const clean = token.toLowerCase().trim();
  if (TOKEN_BLACKLIST.has(clean)) return true;

  // Blacklist common cable specifications like 3Cx300, 3Cx300mm2, 4Cx150, 630sqmm etc.
  if (/\b\d+cx\d+(?:\.\d+)?(?:sqmm|mm2)?\b/i.test(clean)) return true;
  if (/\b\d+(?:sqmm|mm2)\b/i.test(clean)) return true;
  
  const parts = clean.split(/[\/\-_]/);
  if (parts.length > 0) {
    const firstSegment = parts[0].trim();
    if (TOKEN_BLACKLIST.has(firstSegment)) return true;
  }
  
  return false;
}

function extractTenderTokens(rawString) {
  if (!rawString) return [];
  
  const tokens = new Set();
  
  // 1. Slash-separated codes (allowing dots inside the segments)
  // e.g., GEM/2026/B/7429306, BESCOM/2026-27/IND0231, JP/B862-000-XT-MR-0220/80, 30/PR/NBPDCL/2026, 01/XEN/P-III/MM/QH-II/2136, EPMPT-04/26-27
  const slashPattern = /[A-Z0-9_.-]+(?:\s*\/\s*[A-Z0-9_.-]+)+/gi;
  let match;
  while ((match = slashPattern.exec(rawString)) !== null) {
    let token = match[0].trim();
    // Clean trailing/leading garbage
    token = token.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/gi, '');
    if (token.length > 5 && /[0-9]/.test(token)) {
      const segs = token.split('/');
      const allNumeric = segs.every(s => /^\d+$/.test(s.replace(/[\s-]/g, '')));
      if (!allNumeric && !isBlacklistedToken(token)) {
        tokens.add(token);
      }
    }
  }

  // 1b. Dash-separated codes (allowing dots inside the segments)
  // e.g., EPMPT-04-26-27, TPNODL-OT-2026-27-2500001185
  const dashPattern = /[A-Z0-9_.]+(?:\s*-\s*[A-Z0-9_.]+){2,}/gi;
  while ((match = dashPattern.exec(rawString)) !== null) {
    let token = match[0].trim();
    token = token.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/gi, '');
    if (token.length > 5 && /[0-9]/.test(token) && !isBlacklistedToken(token)) {
      tokens.add(token);
    }
  }

  // 2. Underscore-separated patterns (e.g., 2026_MPPKV_512640_1, 2026_HBC_520685_1)
  const underscorePattern = /[a-z0-9]+(?:_[a-z0-9]+){2,}/gi;
  while ((match = underscorePattern.exec(rawString)) !== null) {
    let token = match[0].trim();
    if (token.length > 5 && /[0-9]/.test(token) && !isBlacklistedToken(token)) {
      tokens.add(token);
    }
  }

  // 3. Standalone large numbers (extended to 12 digits, e.g., 1000008002)
  // Must be standalone: NOT preceded or followed by slashes, dots, dashes, underscores, or other alphanumeric characters
  const numberPattern = /(?<![A-Z0-9_.\/-])\d{5,12}(?![A-Z0-9_.\/-])/gi;
  while ((match = numberPattern.exec(rawString)) !== null) {
    const token = match[0];
    if (!isBlacklistedToken(token)) {
      tokens.add(token);
    }
  }

  // 4. Space-separated reference codes (e.g., TS 1704 AAA)
  const spaceRefPattern = /\b[A-Z]{2,4}\s+\d{2,4}\s+[A-Z]{2,4}\b/g;
  while ((match = spaceRefPattern.exec(rawString)) !== null) {
    const token = match[0].trim();
    if (!isBlacklistedToken(token)) {
      tokens.add(token);
    }
  }

  // 4b. Alphanumeric mixed codes (e.g. CC24VJS048, CC25VJS044)
  // Must contain both letters and digits, and be between 6 and 20 characters
  const mixedCodePattern = /\b(?=[A-Z]*\d)(?=\d*[A-Z])[A-Z0-9]{6,20}\b/gi;
  while ((match = mixedCodePattern.exec(rawString)) !== null) {
    const token = match[0].trim();
    if (!isBlacklistedToken(token)) {
      tokens.add(token);
    }
  }

  // 5. Clean up date and year patterns.
  const datePatterns = [
    /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/,      // DD/MM/YY, DD/MM/YYYY, DD.MM.YY, etc.
    /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/,      // YYYY-MM-DD, YYYY/MM/DD, etc.
    /^\d{1,2}[./-][A-Z]{3,9}[./-]\d{2,4}$/i,  // 08-Jul-2025, 31/Jul/23, etc.
    /^\d{1,2}[./-]\d{2,4}$/,                     // MM/YYYY, MM/YY (e.g., 6/2025, 12/26)
  ];

  const yearPatterns = [
    /^\d{4}[./-]\d{2,4}$/,                   // 2025-26, 2025/2026
    /^\d{2}[./-]\d{2}$/                       // 25-26, 25/26
  ];

  const filtered = Array.from(tokens).filter(token => {
    const cleanToken = token.replace(/\s+/g, '');
    
    // Filter out date tokens
    if (datePatterns.some(regex => regex.test(cleanToken))) return false;
    
    // Filter out financial year ranges
    if (yearPatterns.some(regex => regex.test(cleanToken))) return false;
    
    // Filter out simple year numbers like 2026, 2027
    if (/^20\d{2}$/.test(cleanToken)) return false;
    
    return true;
  });

  // Filter out pure numbers if they are a substring of a larger extracted complex token
  const complexTokens = filtered.filter(t => /[_\/\-]/.test(t));
  const finalFiltered = filtered.filter(token => {
    if (/^\d+$/.test(token)) {
      if (complexTokens.some(ct => ct.includes(token))) {
        return false; // Drop standalone number if part of complex token like 2026_MPPKV_512640_1
      }
    }
    return true;
  });

  // Post-process to combine generic prefixes ending with /NIT (e.g. "MD/WZ/06/PUR/NIT")
  const finalTokens = new Set();
  for (let i = 0; i < finalFiltered.length; i++) {
    const tok = finalFiltered[i];
    if (tok.toUpperCase().endsWith('/NIT')) {
      const idx = rawString.indexOf(tok);
      if (idx !== -1) {
        const afterText = rawString.substring(idx + tok.length);
        const matchAfter = afterText.match(/^\s+([A-Z0-9_.-]+(?:\s*\/[A-Z0-9_.-]+)*)/i);
        if (matchAfter) {
          const nextPart = matchAfter[1].trim();
          const hasNextToken = finalFiltered.some(otherTok => otherTok !== tok && nextPart.includes(otherTok));
          if (hasNextToken) {
            finalTokens.add(`${tok} ${nextPart}`);
            continue;
          }
        }
      }
    }
    finalTokens.add(tok);
  }

  return Array.from(finalTokens);
}

/**
 * Normalizes a text string for matching (lowercases, collapses whitespaces).
 * @param {string} text 
 * @returns {string}
 */
function normalizeText(text) {
  if (!text) return '';
  return text.toLowerCase()
    .replace(/[\s\r\n]+/g, ' ') // Collapse whitespaces
    .trim();
}

/**
 * Helper to compile a highly accurate regular expression for a tender token,
 * enforcing word boundaries and flexible spaces.
 * @param {string} token 
 * @returns {RegExp}
 */
function makeTokenRegex(token) {
  const normToken = normalizeText(token);

  // If the token is a pure number, require a tender-specific prefix to prevent false matches
  if (/^\d+$/.test(normToken.replace(/\s/g, ''))) {
    const prefixPattern = '(?:tender|bid|nit|ifb|rfp|rfq|notice|ref|id|no\\.?|nos\\.?|number)\\s*(?:id|no\\.?|number)?\\s*[-:#\\s]*';
    return new RegExp(`${prefixPattern}\\b${normToken.trim()}\\b`, 'i');
  }
  
  // Escape special regex characters
  let escaped = normToken.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  
  // Allow optional spaces around slashes and dashes
  escaped = escaped
    .replace(/\\\/+/g, '\\s*\\/\\s*')
    .replace(/\\-+/g, '\\s*\\-\\s*');
    
  // Convert any remaining spaces into a flexible whitespace matcher (\s+)
  escaped = escaped.replace(/\s+/g, '\\s+');

  // Strict word boundaries: only apply \b if the token starts/ends with alphanumeric characters
  const startsWithAlphanumeric = /^[a-z0-9]/i.test(token);
  const endsWithAlphanumeric = /[a-z0-9]$/i.test(token);

  let pattern = escaped;
  if (startsWithAlphanumeric) {
    pattern = '\\b' + pattern;
  }
  if (endsWithAlphanumeric) {
    pattern = pattern + '\\b';
  }

  return new RegExp(pattern, 'i');
}

/**
 * Helper to compile an exact-match regular expression for a tender token.
 * Unlike makeTokenRegex, this does NOT allow flexible spacing around
 * slashes, dashes, or underscores. Used for participated tenders where
 * only an exact (verbatim) match is accepted.
 * @param {string} token
 * @returns {RegExp}
 */
function makeStrictRegex(token) {
  const normToken = normalizeText(token);

  // If the token is a pure number, require a tender-specific prefix to prevent false matches
  if (/^\d+$/.test(normToken.replace(/\s/g, ''))) {
    const prefixPattern = '(?:tender|bid|nit|ifb|rfp|rfq|notice|ref|id|no\\.?|nos\\.?|number)\\s*(?:id|no\\.?|number)?\\s*[-:#\\s]*';
    return new RegExp(`${prefixPattern}\\b${normToken.trim()}\\b`, 'i');
  }

  // Escape special regex characters, keeping all separators as literals
  const escaped = normToken.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

  // Strict word boundaries
  const startsWithAlphanumeric = /^[a-z0-9]/i.test(token);
  const endsWithAlphanumeric = /[a-z0-9]$/i.test(token);

  let pattern = escaped;
  if (startsWithAlphanumeric) {
    pattern = '\\b' + pattern;
  }
  if (endsWithAlphanumeric) {
    pattern = pattern + '\\b';
  }

  return new RegExp(pattern, 'i');
}

/**
 * Tender-related keywords used for context-aware matching.
 * When a non-distinctive token (e.g., a pure number) is found in the email body,
 * at least one of these keywords must appear nearby to confirm it's a tender match.
 */
const TENDER_KEYWORDS = [
  'tender', 'bid', 'nit', 'rfp', 'rfi', 'eoi', 'enquiry', 'proposal',
  'quotation', 'submission', 'clarification', 'amendment', 'corrigendum',
  'reference', 'contract', 'purchase', 'procurement', 'auction',
  'gem', 'ge-m', 'ref',
];

/**
 * Checks whether a matched token is "distinctive" enough to not require
 * nearby tender context. Tokens with slashes, multiple underscores, or
 * space-separated reference patterns are self-identifying as tender IDs.
 */
function tokenIsDistinctive(token) {
  if (token.includes('/')) return true;
  const underscoreCount = (token.match(/_/g) || []).length;
  if (underscoreCount >= 2) return true;
  if (/^[A-Z]{2,4}\s+\d{2,4}\s+[A-Z]{2,4}$/i.test(token)) return true;
  return false;
}

/**
 * Checks if a tender-related keyword appears within a window around the match position.
 * @param {string} text The normalized text to search.
 * @param {number} matchIndex The index where the token was matched.
 * @param {number} [window=50] Number of chars before/after to check.
 * @returns {boolean}
 */
function hasTenderContext(text, matchIndex, window = 50) {
  const start = Math.max(0, matchIndex - window);
  const end = Math.min(text.length, matchIndex + window);
  const contextSlice = text.slice(start, end);
  return TENDER_KEYWORDS.some(keyword => contextSlice.includes(keyword));
}

/**
 * Checks if a tender matches an email based on the extracted tokens.
 * @param {string[]} tokens Cleaned tokens extracted from the tender.
 * @param {string} emailSubject 
 * @param {string} emailBody 
 * @param {string} ocrText Optional OCR text
 * @returns {{matched: boolean, matchedToken: string, confidence: 'HIGH' | 'MEDIUM' | 'NONE'}}
 */
function checkMatch(tokens, emailSubject, emailBody, ocrText = '') {
  if (!tokens || tokens.length === 0) return { matched: false, matchedToken: '', confidence: 'NONE' };
  
  const normSubject = normalizeText(emailSubject);
  const normBody = normalizeText(emailBody);
  const normOcr = normalizeText(ocrText);

  return checkMatchNormalized(tokens, normSubject, normBody, normOcr);
}

/**
 * Checks if a tender matches an email based on pre-normalized text.
 * @param {string[]} tokens Cleaned tokens extracted from the tender.
 * @param {string} normSubject Pre-normalized subject
 * @param {string} normBody Pre-normalized body
 * @param {string} normOcr Pre-normalized OCR text
 * @returns {{matched: boolean, matchedToken: string, confidence: 'HIGH' | 'MEDIUM' | 'NONE'}}
 */
function checkMatchNormalized(tokens, normSubject, normBody, normOcr = '') {
  if (!tokens || tokens.length === 0) return { matched: false, matchedToken: '', confidence: 'NONE' };

  const compiled = tokens.map(token => ({
    token,
    regex: makeTokenRegex(token)
  }));

  return checkMatchCompiled(compiled, normSubject, normBody, normOcr);
}

/**
 * Checks if a tender matches an email based on pre-compiled regexes.
 * @param {{token: string, regex: RegExp}[]} compiledRegexes Pre-compiled token regexes.
 * @param {string} normSubject Pre-normalized subject
 * @param {string} normBody Pre-normalized body
 * @param {string} normOcr Pre-normalized OCR text
 * @returns {{matched: boolean, matchedToken: string, confidence: 'HIGH' | 'MEDIUM' | 'NONE'}}
 */
function checkMatchCompiled(compiledRegexes, normSubject, normBody, normOcr = '') {
  if (!compiledRegexes || compiledRegexes.length === 0) return { matched: false, matchedToken: '', confidence: 'NONE' };

  for (const { token, regex } of compiledRegexes) {
    // High confidence if matched in Subject
    if (regex.test(normSubject)) {
      return { matched: true, matchedToken: token, confidence: 'HIGH' };
    }

    // Medium confidence if matched in Body
    // Require tender context nearby unless the token is self-identifying
    const bodyMatch = regex.exec(normBody);
    if (bodyMatch) {
      if (tokenIsDistinctive(token) || hasTenderContext(normBody, bodyMatch.index)) {
        return { matched: true, matchedToken: token, confidence: 'MEDIUM' };
      }
    }

    // Medium confidence if matched in OCR Text (from attachments)
    if (normOcr) {
      const ocrMatch = regex.exec(normOcr);
      if (ocrMatch) {
        if (tokenIsDistinctive(token) || hasTenderContext(normOcr, ocrMatch.index)) {
          return { matched: true, matchedToken: token, confidence: 'MEDIUM' };
        }
      }
    }
  }

  return { matched: false, matchedToken: '', confidence: 'NONE' };
}

/**
 * Simplified matching for participated tenders — accepts ANY occurrence of the token
 * (subject → HIGH, body/OCR → MEDIUM) without requiring nearby tender context.
 * The strictness comes from the regex itself (makeStrictRegex), not from context checks.
 */
function strictCheckMatchCompiled(compiledRegexes, normSubject, normBody, normOcr = '') {
  if (!compiledRegexes || compiledRegexes.length === 0) return { matched: false, matchedToken: '', confidence: 'NONE' };

  for (const { token, regex } of compiledRegexes) {
    if (regex.test(normSubject)) {
      return { matched: true, matchedToken: token, confidence: 'HIGH' };
    }
    if (regex.test(normBody)) {
      return { matched: true, matchedToken: token, confidence: 'MEDIUM' };
    }
    if (normOcr && regex.test(normOcr)) {
      return { matched: true, matchedToken: token, confidence: 'MEDIUM' };
    }
  }

  return { matched: false, matchedToken: '', confidence: 'NONE' };
}

/**
 * Creates a regex that matches a value only when surrounded by whitespace or
 * string boundaries (start/end). This prevents numeric tender IDs like "324434"
 * from matching inside larger numbers like "1324434" or amounts like "₹324434.50".
 * @param {string} value The raw value to match (tender_id or ref_id)
 * @returns {RegExp}
 */
function makeWhitespaceBoundaryRegex(value) {
  const normValue = normalizeText(value);
  
  // If the value is a pure number, require a tender-specific prefix to prevent false matches
  if (/^\d+$/.test(normValue.replace(/\s/g, ''))) {
    const prefixPattern = '(?:tender|bid|nit|ifb|rfp|rfq|notice|ref|id|no\\.?|nos\\.?|number)\\s*(?:id|no\\.?|number)?\\s*[-:#\\s]*';
    return new RegExp(`${prefixPattern}\\b${normValue.trim()}\\b`, 'i');
  }

  const escaped = normValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i');
}

module.exports = {
  extractTenderTokens,
  isBlacklistedToken,
  checkMatch,
  checkMatchNormalized,
  checkMatchCompiled,
  strictCheckMatchCompiled,
  normalizeText,
  makeTokenRegex,
  makeStrictRegex,
  makeWhitespaceBoundaryRegex
};
