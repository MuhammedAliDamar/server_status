// PM2 process descriptor — `pm2 start ecosystem.config.js`
// Aynı .env'i hem Next.js hem WS server için yükler.

const fs = require("fs");
const path = require("path");

// .env'i kendi parse'imizle yükle (dotenv dep'sine ihtiyaç yok)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

const PANEL_PORT = process.env.PANEL_PORT || "9852";
const WS_PORT = process.env.WS_PORT || "2589";

const sharedEnv = {
  NODE_ENV: "production",
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  AGENT_REGISTRATION_SECRET: process.env.AGENT_REGISTRATION_SECRET,
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
  PANEL_EXTERNAL_WS_URL: process.env.PANEL_EXTERNAL_WS_URL,
  PANEL_PORT,
  WS_PORT,
};

module.exports = {
  apps: [
    {
      name: "fleet-panel-web",
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${PANEL_PORT}`,
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        ...sharedEnv,
        PORT: PANEL_PORT,
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
      env: sharedEnv,
      max_memory_restart: "256M",
      autorestart: true,
      watch: false,
      out_file: "/var/log/fleet-panel/ws-out.log",
      error_file: "/var/log/fleet-panel/ws-err.log",
      time: true,
    },
  ],
};
