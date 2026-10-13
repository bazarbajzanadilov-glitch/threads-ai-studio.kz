module.exports = {
  apps: [
    {
      name: "threads-publisher",
      script: "apps/server/dist/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOST: "0.0.0.0",
        BASE_URL: "https://threads.ai-studio.kz",
        ADMIN_EMAIL: "bazarbajzanadilov@gmail.com",
        SECOND_ADMIN_EMAIL: "reli.sheets1@gmail.com",
        SESSION_SECRET: "admin_master_secret_2026",
        DATA_DIR: "./data",
        UPLOADS_DIR: "./data/uploads",
        DB_PATH: "./data/threads.db"
      }
    }
  ]
};
