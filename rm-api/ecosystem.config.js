module.exports = {
  apps: [
    {
      name:         'riskmanager-api',
      script:       'src/app.js',
      instances:    2,
      exec_mode:    'cluster',
      watch:        false,
      max_memory_restart: '512M',

      env_production: {
        NODE_ENV: 'production',
        PORT:     3000,
      },

      // Logs
      out_file:   'logs/pm2-out.log',
      error_file: 'logs/pm2-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // Restart policy
      restart_delay:  5000,
      max_restarts:   10,
      min_uptime:     '10s',
    },
  ],
};
