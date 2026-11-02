// Display helpers for tender cards / tables (pure functions, unit-tested in tenderFormat.test.js).

export const MISSING = '—';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_INDEX = MONTHS.reduce((acc, m, i) => ({ ...acc, [m.toLowerCase()]: i }), {});

const pad2 = (n) => String(n).padStart(2, '0');

function validYmd(y, m, d) {
  if (y < 100) y += 2000;
  const dt = new Date(y, m, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
  return { y, m, d };
}

/**
 * Parses the date formats found in the tender sheet. Numeric dates are day-first (Indian format):
 * "24-Aug-2026", "4-Sep-2023", "06-08-2026", "06/08/2026", "06.08.2026", "2026-08-06",
 * "17-08-2026-03:00 PM", "Sep/19/2023 4:00:06".
 * @returns {{y:number,m:number,d:number,time:string|null}|null}
 */
export function parseSheetDate(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || /^(n\/?a|-+|—|na|nil|none|null)$/i.test(s)) return null;

  const timeMatch = s.match(/(\d{1,2}:\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i);
  const time = timeMatch ? `${timeMatch[1]}${timeMatch[2] ? ' ' + timeMatch[2].replace(/\./g, '').toUpperCase() : ''}` : null;

  let m;
  // 24-Aug-2026, 4 Sep 2023, 24/Aug/26
  if ((m = s.match(/^(\d{1,2})[\s./-]+([a-z]{3,9})[\s./,-]+(\d{2,4})/i))) {
    const mi = MONTH_INDEX[m[2].slice(0, 3).toLowerCase()];
    if (mi !== undefined) { const r = validYmd(+m[3], mi, +m[1]); return r && { ...r, time }; }
  }
  // Sep/19/2023, Aug 24, 2026
  if ((m = s.match(/^([a-z]{3,9})[\s./-]+(\d{1,2})[\s./,-]+(\d{2,4})/i))) {
    const mi = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
    if (mi !== undefined) { const r = validYmd(+m[3], mi, +m[2]); return r && { ...r, time }; }
  }
  // 2026-08-06
  if ((m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/))) {
    const r = validYmd(+m[1], +m[2] - 1, +m[3]);
    return r && { ...r, time: /T00:00(:00)?/.test(s) ? null : time };
  }
  // 06-08-2026, 06/08/2026, 06.08.26 (day first)
  if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/))) {
    const r = validYmd(+m[3], +m[2] - 1, +m[1]);
    return r && { ...r, time };
  }
  return null;
}

/**
 * Formats any sheet date as DD-MMM-YYYY (e.g. 06-Aug-2026), keeping a time if the sheet had one.
 * Missing values become "—"; unparseable text is shown as-is so no information is lost.
 */
export function formatSheetDate(value, { withTime = true } = {}) {
  const p = parseSheetDate(value);
  if (!p) {
    const raw = value === null || value === undefined ? '' : String(value).trim();
    return !raw || /^(n\/?a|-+|—|na|nil|none|null)$/i.test(raw) ? MISSING : raw;
  }
  const date = `${pad2(p.d)}-${MONTHS[p.m]}-${p.y}`;
  return withTime && p.time ? `${date}, ${p.time}` : date;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? singular : plural}`;
}

const firstLine = (s) => String(s || '').split(/\r?\n/).map(x => x.trim()).find(Boolean) || '';

/**
 * Card/table title for a tender. The sheet's "Tender For" column holds the bidding company
 * (e.g. "LASER"), so it is not a title: prefer the name of work, then the tender number.
 */
export function getTenderTitle(t) {
  if (!t) return 'Tender';
  const name = firstLine(t.nameOfWork);
  if (name) return name;
  if (t.tenderFor && /^Matched Tender - /.test(t.tenderFor)) return t.tenderFor; // orphan DB match
  const tenderNo = getTenderNumber(t);
  if (tenderNo) return tenderNo;
  return t.docketNo ? `Docket ${t.docketNo}` : 'Tender';
}

/** Short tender number: first extracted ID token, else the raw "Tender No" text without its label. */
export function getTenderNumber(t) {
  if (!t) return '';
  if (Array.isArray(t.tokens) && t.tokens.length > 0) return t.tokens[0];
  return firstLine(t.tenderNoRaw)
    .replace(/^(tender|nit|n\.i\.t\.?|enquiry|specification)[\w\s.]*?(no\.?|number|id)\s*[:.\-–]*\s*/i, '')
    .trim();
}
