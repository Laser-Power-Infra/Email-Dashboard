'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractContacts, rankContacts } = require('../contactSuggest');

test('extracts names and emails from header text', () => {
  const out = extractContacts('"Sharma, Ravi" <Ravi.Sharma@abc.com>, tenders@xyz.in; Puja <puja@laser.com>');
  assert.deepStrictEqual(out, [
    { email: 'ravi.sharma@abc.com', name: 'Sharma, Ravi' },
    { email: 'tenders@xyz.in', name: '' },
    { email: 'puja@laser.com', name: 'Puja' },
  ]);
});

test('ranks matches: prefix first, then frequency, deduped', () => {
  const rows = [
    { sender: 'a.bose@abc.com', to_details: 'Ravi <ravi@abc.com>', cc_details: '' },
    { sender: 'Ravi <ravi@abc.com>', to_details: 'office@abc.com', cc_details: 'ravi@abc.com' },
    { sender: 'x@other.com', to_details: 'travis@abc.com', cc_details: '' },
  ];
  const out = rankContacts(rows, 'ra', { exclude: ['nobody@abc.com'] });
  assert.strictEqual(out[0].email, 'ravi@abc.com');
  assert.strictEqual(out[0].name, 'Ravi');
  assert.strictEqual(out[0].count, 3);
  assert.ok(out.some(c => c.email === 'travis@abc.com'));
  assert.ok(!out.some(c => c.email === 'x@other.com'));
});

test('excludes already-entered addresses and empty query', () => {
  const rows = [{ sender: 'ravi@abc.com', to_details: '', cc_details: '' }];
  assert.deepStrictEqual(rankContacts(rows, 'ravi', { exclude: ['RAVI@abc.com'] }), []);
  assert.deepStrictEqual(rankContacts(rows, ' '), []);
});
