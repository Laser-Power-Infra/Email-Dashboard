// Run with: node --test src/tenderFormat.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSheetDate, pluralize, getTenderTitle, getTenderNumber, MISSING } from './tenderFormat.js';

test('last dates are normalised to DD-MMM-YYYY', () => {
  assert.equal(formatSheetDate('24-Aug-2026'), '24-Aug-2026');
  assert.equal(formatSheetDate('4-Sep-2023'), '04-Sep-2023');
  assert.equal(formatSheetDate('06-08-2026'), '06-Aug-2026');
  assert.equal(formatSheetDate('06/08/2026'), '06-Aug-2026');
  assert.equal(formatSheetDate('06.08.26'), '06-Aug-2026');
  assert.equal(formatSheetDate('2026-08-06'), '06-Aug-2026');
  assert.equal(formatSheetDate('17-08-2026-03:00 PM'), '17-Aug-2026, 03:00 PM');
  assert.equal(formatSheetDate('Sep/19/2023 4:00:06'), '19-Sep-2023, 4:00');
});

test('missing dates show an em dash, unknown text is kept', () => {
  assert.equal(formatSheetDate(''), MISSING);
  assert.equal(formatSheetDate(null), MISSING);
  assert.equal(formatSheetDate('N/A'), MISSING);
  assert.equal(formatSheetDate('To be announced'), 'To be announced');
  assert.equal(formatSheetDate('31-02-2026'), '31-02-2026'); // invalid day is not silently shifted
});

test('pluralize', () => {
  assert.equal(pluralize(1, 'email'), '1 email');
  assert.equal(pluralize(0, 'email'), '0 emails');
  assert.equal(pluralize(5, 'email'), '5 emails');
});

test('tender title never falls back to the company name', () => {
  const base = { tenderFor: 'LASER', docketNo: 'D1', tenderNoRaw: 'Tender Enquiry No.: TPCODL/CCG/23-24/013' };
  assert.equal(getTenderTitle({ ...base, nameOfWork: 'Rate Contract for Supply of 11 KV Cable\nfor TPCODL' }), 'Rate Contract for Supply of 11 KV Cable');
  assert.equal(getTenderTitle({ ...base, tokens: ['TPCODL/CCG/23-24/013'] }), 'TPCODL/CCG/23-24/013');
  assert.equal(getTenderTitle(base), 'TPCODL/CCG/23-24/013');
  assert.equal(getTenderNumber({ tenderNoRaw: 'NIT No - P-30/2023-24' }), 'P-30/2023-24');
});
