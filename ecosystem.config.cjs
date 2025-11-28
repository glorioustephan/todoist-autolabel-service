module.exports = {
  apps: [
    {
      name: 'todoist-autolabel',
      script: 'dist/service.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      // Restart on failure with exponential backoff
      exp_backoff_restart_delay: 100,
      // Don't restart more than 10 times in 15 minutes
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};

