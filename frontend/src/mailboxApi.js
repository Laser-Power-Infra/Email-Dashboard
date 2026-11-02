const cache = new Map();
const inFlight = new Map();

function makeError(data, status) {
  const error = new Error(
    (data && (data.message || data.details || data.error)) ||
    `Request failed with status ${status}`
  );
  error.status = status;
  error.data = data || {};
  return error;
}

export async function mailboxGet(url, { ttlSeconds = 0, force = false } = {}) {
  const key = String(url);
  if (!force && ttlSeconds > 0) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
  }

  if (inFlight.has(key)) return inFlight.get(key);

  const promise = fetch(key)
    .then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw makeError(data, res.status);
      if (ttlSeconds > 0) {
        cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
      }
      return data;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

export async function mailboxSend(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw makeError(data, res.status);
  return data;
}

export function clearMailboxApiCache(prefix = '') {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function isQuotaError(error) {
  return Boolean(error && (error.status === 429 || (error.data && (error.data.isQuota || error.data.error === 'GMAIL_QUOTA'))));
}

export function quotaRetryAfter(error) {
  const value = Number(error && error.data && error.data.retryAfter);
  return Number.isFinite(value) && value > 0 ? value : 60;
}
