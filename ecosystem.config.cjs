const path = require('path');

module.exports = {
  apps: [
    {
      name: 'todoist-autolabel',
      script: path.join(__dirname, 'dist', 'service.js'),
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--enable-source-maps',
      },
      // Use absolute paths for log files
      error_file: path.join(__dirname, 'logs', 'pm2-error.log'),
      out_file: path.join(__dirname, 'logs', 'pm2-out.log'),
      log_file: path.join(__dirname, 'logs', 'pm2-combined.log'),
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      // Restart on failure with exponential backoff
      exp_backoff_restart_delay: 100,
      // Don't restart more than 10 times in 15 minutes
      max_restarts: 10,
      min_uptime: '10s',
      // Kill timeout for graceful shutdown
      kill_timeout: 5000,
      // Listen for shutdown signals
      listen_timeout: 3000,
    },
  ],
};

