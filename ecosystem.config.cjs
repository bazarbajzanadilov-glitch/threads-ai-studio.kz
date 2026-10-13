module.exports = {
  apps: [
    {
      name: 'threads-publisher',
      cwd: '/var/www/threads-publisher',
      script: 'apps/server/dist/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3005,
        HOST: '0.0.0.0',
        BASE_URL: 'https://threads.ai-studio.kz',
        ADMIN_EMAIL: 'bazarbajzanadilov@gmail.com',
        SECOND_ADMIN_EMAIL: 'reli.sheets1@gmail.com',
        SESSION_SECRET: 'admin_master_secret_2026',
        DATA_DIR: '/var/www/threads-publisher/data',
        UPLOADS_DIR: '/var/www/threads-publisher/data/uploads',
        DB_PATH: '/var/www/threads-publisher/data/threads.db'
      }
    }
  ]
};
