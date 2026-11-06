// Cấu hình PM2 — giữ backend chạy nền, tự restart khi crash hoặc khi VPS reboot.
// Dùng: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'ceoketnoitinhhoa-api',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
