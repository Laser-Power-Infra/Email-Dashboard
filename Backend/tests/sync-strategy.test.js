const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldUseFullSync } = require('../syncStrategy');

test('forces full sync when requested explicitly', () => {
  assert.equal(shouldUseFullSync(true, {}), true);
});

test('forces full sync when env flag is enabled', () => {
  assert.equal(shouldUseFullSync(false, { FORCE_FULL_SYNC: 'true' }), true);
  assert.equal(shouldUseFullSync(false, { FORCE_FULL_SYNC: '1' }), true);
});

test('keeps incremental sync by default', () => {
  assert.equal(shouldUseFullSync(false, {}), false);
});
