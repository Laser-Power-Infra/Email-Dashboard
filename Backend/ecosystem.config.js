module.exports = {
  apps: [{
    name: 'match-emails-portal',
    script: 'server.js',
    cwd: __dirname,
    watch: false,
    max_restarts: 10,
    restart_delay: 5000,
    exp_backoff_restart_delay: 10000,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
