const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveOllamaConfig, probeOllama, AiHealthMonitor, isConnectionError } = require('../aiHealth');

const silent = { log() {}, warn() {}, error() {} };

test('OLLAMA_BASE_URL wins, OLLAMA_HOST is honoured, /v1 is normalised', () => {
  assert.equal(resolveOllamaConfig({ OLLAMA_BASE_URL: 'http://a:11434/v1', OLLAMA_MODEL: 'm' }).baseURL, 'http://a:11434/v1');
  assert.equal(resolveOllamaConfig({ OLLAMA_HOST: 'http://b:11434', OLLAMA_MODEL: 'm' }).root, 'http://b:11434');
  assert.equal(resolveOllamaConfig({ OLLAMA_HOST: 'b:11434', OLLAMA_MODEL: 'm' }).baseURL, 'http://b:11434/v1');
});

test('config warnings: conflicting hosts and missing model', () => {
  const cfg = resolveOllamaConfig({ OLLAMA_BASE_URL: 'http://a:11434/v1', OLLAMA_HOST: 'http://b:11434' });
  assert.ok(cfg.warnings.some(w => w.includes('different hosts')));
  assert.ok(cfg.warnings.some(w => w.includes('OLLAMA_MODEL is not set')));
});

const fakeFetch = (models) => async () => ({ ok: true, status: 200, json: async () => ({ models: models.map(name => ({ name })) }) });
const failingFetch = async () => { const e = new Error('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; };

test('probe: ok / degraded (model missing) / down', async () => {
  const cfg = { root: 'http://x:11434', model: 'gemma4:e4b' };
  assert.equal((await probeOllama(cfg, { fetchImpl: fakeFetch(['gemma4:e4b']) })).status, 'ok');
  const degraded = await probeOllama(cfg, { fetchImpl: fakeFetch(['llama3:latest']) });
  assert.equal(degraded.status, 'degraded');
  assert.match(degraded.error, /ollama pull gemma4:e4b/);
  const down = await probeOllama(cfg, { fetchImpl: failingFetch });
  assert.equal(down.status, 'down');
  assert.match(down.error, /ECONNREFUSED/);
});

test('monitor fires down and recovered alerts through hooks', async () => {
  let fetchImpl = failingFetch;
  const monitor = new AiHealthMonitor({
    env: { OLLAMA_BASE_URL: 'http://x:11434/v1', OLLAMA_MODEL: 'gemma4:e4b' },
    logger: silent,
    fetchImpl: (...args) => fetchImpl(...args)
  });
  const events = [];
  monitor.onAlert(({ type }) => events.push(type));

  await monitor.check();
  assert.equal(monitor.getState().status, 'down');
  assert.ok(monitor._nextDelay() >= 10000);

  fetchImpl = fakeFetch(['gemma4:e4b']);
  await monitor.check();
  assert.equal(monitor.getState().status, 'ok');
  assert.deepEqual(events, ['down', 'recovered']);
});

test('isConnectionError recognises network failures only', () => {
  assert.equal(isConnectionError({ code: 'ECONNREFUSED' }), true);
  assert.equal(isConnectionError(new Error('Connection error.')), true);
  assert.equal(isConnectionError(new Error('400 invalid model')), false);
});
