/**
 * AI engine (Ollama) health monitor.
 *
 * - Resolves the Ollama URL/model from the environment in ONE place
 *   (OLLAMA_BASE_URL > OLLAMA_HOST > docker/localhost default).
 * - Periodically probes `GET <root>/api/tags` and checks the configured model is pulled.
 * - Retries with exponential backoff while the engine is down, and reports recovery.
 * - Emits alerts on state transitions: console log, registered hooks (onAiEngineAlert),
 *   and an optional webhook (AI_ALERT_WEBHOOK_URL) usable for Slack/Teams/n8n/email relays.
 * - Collects configuration warnings so the dashboard can show "config looks wrong" hints.
 */
const fs = require('fs');

const DEFAULT_MODEL = 'gemma4:e4b';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_INTERVAL_MS = 60 * 1000;
const MIN_RETRY_MS = 10 * 1000;
const MAX_RETRY_MS = 5 * 60 * 1000;

function isInDocker() {
  try {
    return fs.existsSync('/.dockerenv');
  } catch (e) {
    return false;
  }
}

function stripTrailingSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

/**
 * Normalises an Ollama URL into the OpenAI-compatible base (".../v1") and the native root.
 * Accepts "host:port", "http://host:port", "http://host:port/v1".
 */
function normaliseOllamaUrl(raw) {
  let url = stripTrailingSlash(raw);
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  const root = url.replace(/\/v1$/i, '');
  return { root, baseURL: `${root}/v1` };
}

/**
 * Single source of truth for the Ollama endpoint/model.
 * @param {NodeJS.ProcessEnv} env
 */
function resolveOllamaConfig(env = process.env) {
  const warnings = [];
  const inDocker = isInDocker();
  let source;
  let urls;

  if (env.OLLAMA_BASE_URL) {
    source = 'OLLAMA_BASE_URL';
    urls = normaliseOllamaUrl(env.OLLAMA_BASE_URL);
  } else if (env.OLLAMA_HOST) {
    source = 'OLLAMA_HOST';
    urls = normaliseOllamaUrl(env.OLLAMA_HOST);
  } else {
    source = 'default';
    urls = normaliseOllamaUrl(inDocker ? 'http://host.docker.internal:11434' : 'http://localhost:11434');
  }

  if (env.OLLAMA_BASE_URL && env.OLLAMA_HOST) {
    const other = normaliseOllamaUrl(env.OLLAMA_HOST);
    if (other && urls && other.root !== urls.root) {
      warnings.push(`OLLAMA_BASE_URL (${urls.root}) and OLLAMA_HOST (${other.root}) point to different hosts; OLLAMA_BASE_URL wins.`);
    }
  }

  if (inDocker && urls && /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(urls.root)) {
    warnings.push(`Ollama URL ${urls.root} uses localhost inside a Docker container; it should normally be http://host.docker.internal:11434 (or the Ollama server's LAN IP).`);
  }

  const model = (env.OLLAMA_MODEL || DEFAULT_MODEL).trim();
  if (!env.OLLAMA_MODEL) {
    warnings.push(`OLLAMA_MODEL is not set; using built-in default '${DEFAULT_MODEL}'. Make sure this model is pulled on the Ollama server (ollama list).`);
  }

  return {
    root: urls ? urls.root : null,
    baseURL: urls ? urls.baseURL : null,
    model,
    source,
    inDocker,
    warnings
  };
}

function modelMatches(available, wanted) {
  if (!wanted) return false;
  const w = wanted.toLowerCase();
  const wNoTag = w.includes(':') ? w : `${w}:latest`;
  return available.some(name => {
    const n = String(name || '').toLowerCase();
    return n === w || n === wNoTag;
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One-shot probe of the Ollama server.
 * @returns {Promise<{status:'ok'|'degraded'|'down', reachable:boolean, modelAvailable:boolean, availableModels:string[], error:string|null, latencyMs:number}>}
 */
async function probeOllama(config, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl } = {}) {
  const started = Date.now();
  const doFetch = fetchImpl || fetchWithTimeout;
  if (!config.root) {
    return { status: 'down', reachable: false, modelAvailable: false, availableModels: [], error: 'No Ollama URL configured', latencyMs: 0 };
  }
  try {
    const res = await doFetch(`${config.root}/api/tags`, { method: 'GET' }, timeoutMs);
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return { status: 'down', reachable: true, modelAvailable: false, availableModels: [], error: `Ollama responded HTTP ${res.status}`, latencyMs };
    }
    const body = await res.json().catch(() => ({}));
    const availableModels = Array.isArray(body.models) ? body.models.map(m => m.name || m.model).filter(Boolean) : [];
    const modelAvailable = modelMatches(availableModels, config.model);
    return {
      status: modelAvailable ? 'ok' : 'degraded',
      reachable: true,
      modelAvailable,
      availableModels,
      error: modelAvailable ? null : `Model '${config.model}' is not pulled on the Ollama server (available: ${availableModels.join(', ') || 'none'}). Run: ollama pull ${config.model}`,
      latencyMs
    };
  } catch (err) {
    const reason = err && err.name === 'AbortError'
      ? `Timed out after ${timeoutMs}ms`
      : ((err && err.cause && err.cause.code) || (err && err.message) || String(err));
    return { status: 'down', reachable: false, modelAvailable: false, availableModels: [], error: `Cannot reach Ollama at ${config.root}: ${reason}`, latencyMs: Date.now() - started };
  }
}

class AiHealthMonitor {
  constructor({ env = process.env, logger = console, intervalMs, timeoutMs, fetchImpl } = {}) {
    this.env = env;
    this.logger = logger;
    this.intervalMs = Number(intervalMs || env.AI_HEALTH_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
    this.timeoutMs = Number(timeoutMs || env.AI_HEALTH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    this.fetchImpl = fetchImpl;
    this.hooks = [];
    this.timer = null;
    this.consecutiveFailures = 0;
    this.inFlight = null;
    this.state = {
      status: 'unknown',
      provider: 'ollama',
      ...this._publicConfig(),
      reachable: false,
      modelAvailable: false,
      availableModels: [],
      error: null,
      latencyMs: null,
      lastCheckedAt: null,
      lastOkAt: null,
      downSince: null,
      consecutiveFailures: 0,
      nextCheckInMs: null
    };
  }

  _publicConfig() {
    const cfg = resolveOllamaConfig(this.env);
    this.config = cfg;
    return { url: cfg.root, baseURL: cfg.baseURL, model: cfg.model, configSource: cfg.source, configWarnings: cfg.warnings };
  }

  /** Register an alert hook: fn({ type: 'down'|'recovered'|'degraded', state }) */
  onAlert(fn) {
    if (typeof fn === 'function') this.hooks.push(fn);
    return () => { this.hooks = this.hooks.filter(h => h !== fn); };
  }

  getState() {
    return { ...this.state };
  }

  isHealthy() {
    return this.state.status === 'ok';
  }

  async _emit(type) {
    const state = this.getState();
    const msg = type === 'recovered'
      ? `[AI Health] Ollama recovered at ${state.url} (model ${state.model}).`
      : `[AI Health] ALERT: Ollama ${type.toUpperCase()} at ${state.url} (model ${state.model}): ${state.error}. Portal is using rule-based/regex fallback.`;
    if (type === 'recovered') this.logger.log(msg); else this.logger.error(msg);

    for (const hook of this.hooks) {
      try { await hook({ type, state, message: msg }); } catch (e) { this.logger.warn('[AI Health] alert hook failed:', e.message); }
    }

    const webhook = this.env.AI_ALERT_WEBHOOK_URL;
    if (webhook) {
      try {
        await fetchWithTimeout(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'match-emails-portal', event: `ai_engine_${type}`, text: msg, state })
        }, this.timeoutMs);
      } catch (e) {
        this.logger.warn('[AI Health] alert webhook failed:', e.message);
      }
    }
  }

  /** Probe now (de-duplicated if a probe is already running). */
  async check() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      Object.assign(this.state, this._publicConfig());
      const prevStatus = this.state.status;
      const result = await probeOllama(this.config, { timeoutMs: this.timeoutMs, fetchImpl: this.fetchImpl });
      const now = new Date().toISOString();

      Object.assign(this.state, result, { lastCheckedAt: now });
      if (result.status === 'ok') {
        this.consecutiveFailures = 0;
        this.state.lastOkAt = now;
        this.state.downSince = null;
      } else {
        this.consecutiveFailures++;
        if (!this.state.downSince) this.state.downSince = now;
      }
      this.state.consecutiveFailures = this.consecutiveFailures;

      if (result.status !== prevStatus) {
        if (result.status === 'ok' && prevStatus !== 'unknown') await this._emit('recovered');
        else if (result.status === 'ok') this.logger.log(`[AI Health] Ollama OK at ${this.state.url} (model ${this.state.model}, ${result.latencyMs}ms).`);
        else await this._emit(result.status); // 'down' or 'degraded'
      }
      return this.getState();
    })();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  /** Delay before the next probe: normal interval when healthy, exponential backoff retries when not. */
  _nextDelay() {
    if (this.state.status === 'ok') return this.intervalMs;
    const backoff = MIN_RETRY_MS * Math.pow(2, Math.max(0, this.consecutiveFailures - 1));
    return Math.min(backoff, MAX_RETRY_MS, Math.max(this.intervalMs, MIN_RETRY_MS) * 5);
  }

  start() {
    if (this.timer) return;
    const loop = async () => {
      try { await this.check(); } catch (e) { this.logger.warn('[AI Health] check failed:', e.message); }
      const delay = this._nextDelay();
      this.state.nextCheckInMs = delay;
      this.timer = setTimeout(loop, delay);
      if (this.timer.unref) this.timer.unref();
    };
    this.timer = setTimeout(loop, 0);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** True when an error looks like "server unreachable" (worth a reconnect/retry) rather than a bad request. */
function isConnectionError(err) {
  if (!err) return false;
  const code = err.code || (err.cause && err.cause.code) || '';
  const msg = String(err.message || '').toLowerCase();
  return ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
    || msg.includes('connection error') || msg.includes('econnrefused') || msg.includes('fetch failed') || msg.includes('timed out');
}

module.exports = {
  resolveOllamaConfig,
  normaliseOllamaUrl,
  probeOllama,
  modelMatches,
  isConnectionError,
  AiHealthMonitor
};
