// PM2 process descriptor — `pm2 start ecosystem.config.js`
// Hem panel (Next.js prod) hem WS server'ı tek dosyadan yönetir

module.exports = {
  apps: [
    {
      name: "fleet-panel-web",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PANEL_PORT || 3000,
      },
      max_memory_restart: "512M",
      autorestart: true,
      watch: false,
      out_file: "/var/log/fleet-panel/web-out.log",
      error_file: "/var/log/fleet-panel/web-err.log",
      time: true,
    },
    {
      name: "fleet-panel-ws",
      script: "npx",
      args: "tsx server/ws-server.ts",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "256M",
      autorestart: true,
      watch: false,
      out_file: "/var/log/fleet-panel/ws-out.log",
      error_file: "/var/log/fleet-panel/ws-err.log",
      time: true,
    },
  ],
};
