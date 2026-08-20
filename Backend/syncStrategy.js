function shouldUseFullSync(forceFullSync = false, env = process.env) {
  return Boolean(forceFullSync || env.FORCE_FULL_SYNC === 'true' || env.FORCE_FULL_SYNC === '1');
}

module.exports = { shouldUseFullSync };
