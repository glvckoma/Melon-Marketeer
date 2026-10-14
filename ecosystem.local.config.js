module.exports = {
  apps: [
    {
      name: 'marketeer-bot',
      script: 'index.js',
      cwd: '.',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        AUTO_START: '1',
        AUTO_LOGIN_COUNT: '10',
        LOGIN_STAGGER_MS: '4000',
        SCRAPE_MAX_PORTAL_HOPS: '2',
        ROLLUP_INTERVAL_MS: '120000',
        STATS_TTL_MS: '600000'
      }
    },
    {
      name: 'marketeer-web',
      script: 'web/serve.js',
      cwd: '.',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      watch: ['web', 'api', 'db'],
      ignore_watch: ['node_modules', 'data', 'web/public/wiki', 'web/public/items'],
      watch_options: { usePolling: true },
      env: {
        PORT: '3200',
        STATS_TTL_MS: '600000'
      }
    }
  ]
};
