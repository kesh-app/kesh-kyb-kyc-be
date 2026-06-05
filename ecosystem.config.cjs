// PM2 Ecosystem Config — kesh-kyb-kyc-be
// Usage: pm2 start ecosystem.config.cjs --env development
'use strict';

module.exports = {
  apps: [
    {
      name: 'kesh-kyb-kyc-be-dev',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      cwd: '/var/www/kesh-kyb-kyc-be',
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',

      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_file: 'logs/pm2-combined.log',
      time: true,

      env_development: {
        NODE_ENV: 'development',
        // Env values are loaded from .env — do NOT put secrets here.
        // All other vars (DATABASE_URL, JWT_SECRET, etc.) must exist in .env on the server.
      },
    },
  ],
};
