const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeText } = require('../matcher');
const {
  prepareTendersForMatching,
  findBestTenderForThread,
  hasIdEvidence
} = require('../tenderMatchSelector');

const TENDERS = [
  { docketNo: 'D1', rowNumber: 10, isParticipated: true, tenderNoRaw: 'Tender Id : 2026_WBSED_553516_1' },
  { docketNo: 'D2', rowNumber: 11, isParticipated: true, tenderNoRaw: 'GEM/2026/B/7818857' },
  { docketNo: 'D3', rowNumber: 12, isParticipated: false, tenderNoRaw: 'NIT No - EAV-41/2026-27' },
  { docketNo: 'D4', rowNumber: 13, isParticipated: true, tenderNoRaw: 'GEM/2026/B/7765636' },
  { docketNo: 'D5', rowNumber: 14, isParticipated: false, tenderNoRaw: 'Tender No. TPNODL-OT-2026-27-2500001185' },
  // same tender number listed twice in the sheet (re-submission row): must still resolve to ONE
  { docketNo: 'D6', rowNumber: 20, isParticipated: true, tenderNoRaw: 'GEM/2026/B/1111111' },
  { docketNo: 'D7', rowNumber: 21, isParticipated: true, tenderNoRaw: 'GEM/2026/B/1111111' }
];

const prepared = prepareTendersForMatching(TENDERS);
const email = (subject, body = '', ocr = '') => ({
  normSubject: normalizeText(subject),
  normBody: normalizeText(body),
  normOcr: normalizeText(ocr)
});

test('generic company words and dates are not tender evidence', () => {
  const r = findBestTenderForThread(prepared, email(
    'Fwd: LASER POWER : SECURITY DEPOSIT 30.06.2026',
    'Dear Sir, please release the security deposit of Laser Power & Infra Pvt Ltd dated 30.06.2026. Ref no 2026.'
  ));
  assert.equal(r.best, null);
});

test('an email listing several different tenders is not linked to all (or a random one) of them', () => {
  const r = findBestTenderForThread(prepared, email(
    'Fwd: LASER POWER : SECURITY DEPOSIT 30.06.2026',
    'SD refund pending for 2026_WBSED_553516_1, GEM/2026/B/7818857, EAV-41/2026-27, GEM/2026/B/7765636 and TPNODL-OT-2026-27-2500001185'
  ));
  assert.equal(r.best, null);
  assert.match(r.reason, /ambiguous/);
  assert.ok(r.candidates.length >= 4);
});

test('tender ID in the subject beats a different ID mentioned in the body', () => {
  const r = findBestTenderForThread(prepared, email(
    'Clarification: GEM/2026/B/7818857',
    'This is unrelated to GEM/2026/B/7765636.'
  ));
  assert.equal(r.best.tender.docketNo, 'D2');
  assert.equal(r.best.confidence, 'HIGH');
});

test('single clear tender ID in the body is matched with MEDIUM confidence', () => {
  const r = findBestTenderForThread(prepared, email('Re: query', 'Please refer tender EAV-41/2026-27 for details'));
  assert.equal(r.best.tender.docketNo, 'D3');
  assert.equal(r.best.confidence, 'MEDIUM');
});

test('duplicate sheet rows for the same tender number resolve to exactly one (latest row)', () => {
  const r = findBestTenderForThread(prepared, email('Bid GEM/2026/B/1111111 submitted'));
  assert.ok(r.best);
  assert.equal(r.best.tender.docketNo, 'D7');
});

test('hasIdEvidence rejects generic tokens', () => {
  assert.equal(hasIdEvidence('30.06.2026'), false);
  assert.equal(hasIdEvidence('LASER-12'), false);
  assert.equal(hasIdEvidence('GEM/2026/B/7818857'), true);
  assert.equal(hasIdEvidence('2026_WBSED_553516_1'), true);
});
