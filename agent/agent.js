#!/usr/bin/env node
// fleet-agent — her sunucuda çalışan hafif metric/komut collector
// Mod 1 (token): AGENT_TOKEN env var ile çalış
// Mod 2 (auto-register): AGENT_REGISTER_SECRET + PANEL_HTTP_URL ile başla → token al → devam et

import os from "node:os";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const execFileAsync = promisify(execFile);

// PANEL_URL: panel'in ws endpoint'i — örn: ws://panel.example.com:4000/agent
const RAW_PANEL_URL = process.env.PANEL_URL || "ws://localhost:4000";
const PANEL_URL = RAW_PANEL_URL.endsWith("/agent") ? RAW_PANEL_URL : `${RAW_PANEL_URL.replace(/\/$/, "")}/agent`;
// Auto-register için panel'in HTTP URL'si (genelde PANEL_URL'den türetilir)
const PANEL_HTTP_URL = process.env.PANEL_HTTP_URL ||
  PANEL_URL.replace(/^wss?:\/\//, (m) => m === "wss://" ? "https://" : "http://")
    .replace(/:(\d+)\/agent$/, (_, p) => `:${parseInt(p, 10) - 1000}`)  // 4000 → 3000
    .replace(/\/agent$/, "");

const AGENT_REGISTER_SECRET = process.env.AGENT_REGISTER_SECRET || "";
const TOKEN_FILE = process.env.AGENT_TOKEN_FILE || "/opt/fleet-agent/.token";
let AGENT_TOKEN = process.env.AGENT_TOKEN || "";
const HOSTNAME = process.env.AGENT_HOSTNAME || os.hostname();
const SNAPSHOT_INTERVAL_MS = parseInt(process.env.SNAPSHOT_INTERVAL_MS || "2000", 10);
const RECONNECT_DELAY_MS = 3000;
const AGENT_VERSION = "0.1.0";

// İzin verilen komutlar (whitelist) — keyfi shell yok
const ALLOWED_ACTIONS = new Set(["start", "stop", "restart"]);
const ALLOWED_MSG_TYPES = new Set(["ping", "cmd", "log:subscribe", "log:unsubscribe"]);

// Güvenlik sabitleri
const MAX_MESSAGE_SIZE = 8 * 1024;            // panel'den gelen WS mesajı max 8KB
const MAX_LOG_STREAMS = 8;                    // eş zamanlı log stream limiti
const CMD_RATE_LIMIT_PER_MIN = 30;            // dakikada max komut sayısı
const TOKEN_FORMAT = /^flt_[A-Za-z0-9]{30,80}$/;  // bcrypt DoS önleme: bilinen format dışı reddet
const MAX_INVALID_MSGS = 10;                  // bu sayıyı aşan invalid mesaj → bağlantı kop

// ---------- Fingerprint (unique machine ID) ----------

function readFirst(paths) {
  for (const p of paths) {
    try {
      const v = fsSync.readFileSync(p, "utf8").trim();
      if (v) return v;
    } catch {}
  }
  return "";
}

function getMachineFingerprint() {
  let raw = readFirst(["/etc/machine-id", "/var/lib/dbus/machine-id"]);
  if (!raw) {
    // Mac/BSD fallback: ana MAC + hostname
    const ifaces = os.networkInterfaces();
    const macs = [];
    for (const ifs of Object.values(ifaces)) {
      for (const i of ifs || []) {
        if (i && !i.internal && i.mac && i.mac !== "00:00:00:00:00:00") macs.push(i.mac);
      }
    }
    raw = macs.sort().join("|") || os.hostname();
  }
  return crypto.createHash("sha256").update(raw + "|" + os.hostname()).digest("hex").slice(0, 32);
}

const FINGERPRINT = getMachineFingerprint();

// ---------- Token yükleme veya auto-register ----------

async function loadOrRegisterToken() {
  if (AGENT_TOKEN && TOKEN_FORMAT.test(AGENT_TOKEN)) return AGENT_TOKEN;

  // Daha önce kaydedilmiş token dosyası?
  try {
    const saved = fsSync.readFileSync(TOKEN_FILE, "utf8").trim();
    if (TOKEN_FORMAT.test(saved)) {
      console.log("[agent] token loaded from", TOKEN_FILE);
      return saved;
    }
  } catch {}

  // Auto-register
  if (!AGENT_REGISTER_SECRET) {
    console.error("[fatal] AGENT_TOKEN or AGENT_REGISTER_SECRET (+ PANEL_HTTP_URL) gerekli");
    process.exit(1);
  }

  console.log(`[agent] auto-registering to ${PANEL_HTTP_URL}/api/agents/register`);
  const body = {
    registerSecret: AGENT_REGISTER_SECRET,
    fingerprint: FINGERPRINT,
    hostname: HOSTNAME,
    os: `${os.type()} ${os.release()}`,
    cpuCores: os.cpus().length,
    totalMem: os.totalmem(),
  };

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${PANEL_HTTP_URL}/api/agents/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) {
        console.error("[agent] rate limited, waiting 30s");
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }
      if (!res.ok) {
        const err = await res.text();
        console.error(`[fatal] register failed: ${res.status} ${err}`);
        process.exit(1);
      }
      const data = await res.json();
      if (!TOKEN_FORMAT.test(data.token)) {
        console.error("[fatal] register: invalid token in response");
        process.exit(1);
      }
      // Token'ı kaydet (sonraki restartlarda yeniden register olmasın)
      try {
        fsSync.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
        fsSync.writeFileSync(TOKEN_FILE, data.token, { mode: 0o600 });
      } catch (e) {
        console.warn("[warn] token file write failed:", e.message);
      }
      console.log(`[agent] registered as "${data.name}" (id=${data.serverId})`);
      return data.token;
    } catch (err) {
      console.error(`[agent] register attempt ${attempt} failed:`, err.message);
      if (attempt < 5) await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }

  console.error("[fatal] register: max attempts reached");
  process.exit(1);
}

// PANEL_URL ws://localhost veya bilinen host dışında wss:// olmalı (TLS uyarısı)
if (PANEL_URL.startsWith("ws://") && !/^ws:\/\/(localhost|127\.0\.0\.1)/.test(PANEL_URL)) {
  console.warn("[security] PANEL_URL is plain ws:// — token traverses unencrypted. Use wss:// in production.");
}

// ---------- Metric toplama ----------

let lastCpuInfo = os.cpus().map((c) => ({
  idle: c.times.idle,
  total: Object.values(c.times).reduce((a, b) => a + b, 0),
}));

function readCpuPerCore() {
  const cores = os.cpus();
  const result = cores.map((c, i) => {
    const total = Object.values(c.times).reduce((a, b) => a + b, 0);
    const idle = c.times.idle;
    const prev = lastCpuInfo[i] || { idle: 0, total: 0 };
    const diffIdle = idle - prev.idle;
    const diffTotal = total - prev.total;
    const usage = diffTotal > 0 ? 1 - diffIdle / diffTotal : 0;
    return { usage: Math.max(0, Math.min(1, usage)) * 100, idle, total };
  });
  lastCpuInfo = result.map((r) => ({ idle: r.idle, total: r.total }));
  return result.map((r) => Number(r.usage.toFixed(1)));
}

let lastNet = { rx: 0, tx: 0, ts: Date.now() };
async function readNetwork() {
  // Linux: /proc/net/dev — Mac'te çalışmaz, 0 döner
  try {
    const data = await fs.readFile("/proc/net/dev", "utf8");
    let rx = 0, tx = 0;
    for (const line of data.split("\n").slice(2)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const iface = parts[0].replace(":", "");
      if (iface === "lo" || iface.startsWith("docker") || iface.startsWith("veth")) continue;
      rx += parseInt(parts[1] || "0", 10);
      tx += parseInt(parts[9] || "0", 10);
    }
    const now = Date.now();
    const dt = (now - lastNet.ts) / 1000;
    const dRx = dt > 0 ? Math.max(0, (rx - lastNet.rx) / dt) : 0;
    const dTx = dt > 0 ? Math.max(0, (tx - lastNet.tx) / dt) : 0;
    lastNet = { rx, tx, ts: now };
    return { netRx: dRx, netTx: dTx };
  } catch {
    return { netRx: 0, netTx: 0 };
  }
}

async function readDisk() {
  try {
    const { stdout } = await execFileAsync("df", ["-Pk", "/"]);
    const lines = stdout.trim().split("\n");
    const parts = lines[lines.length - 1].split(/\s+/);
    return {
      diskUsed: parseInt(parts[2], 10) * 1024,
      diskTotal: parseInt(parts[1], 10) * 1024,
    };
  } catch {
    return { diskUsed: 0, diskTotal: 0 };
  }
}

async function readMetrics() {
  const cpuPerCore = readCpuPerCore();
  const cpuAvg = cpuPerCore.reduce((a, b) => a + b, 0) / cpuPerCore.length;
  const load = os.loadavg();
  const [{ diskUsed, diskTotal }, { netRx, netTx }] = await Promise.all([
    readDisk(),
    readNetwork(),
  ]);
  return {
    cpu: Number(cpuAvg.toFixed(1)),
    cpuPerCore,
    memUsed: os.totalmem() - os.freemem(),
    memTotal: os.totalmem(),
    diskUsed,
    diskTotal,
    load1: load[0],
    load5: load[1],
    load15: load[2],
    netRx,
    netTx,
    uptime: os.uptime(),
  };
}

// ---------- PM2 ----------

async function readPm2List() {
  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"], { maxBuffer: 5 * 1024 * 1024 });
    const list = JSON.parse(stdout || "[]");
    return Promise.all(list.map(async (p) => {
      const cwd = p.pm2_env?.pm_cwd;
      const git = cwd ? await readGitInfo(cwd) : null;
      return {
        pm2Id: p.pm_id,
        name: p.name,
        status: p.pm2_env?.status || "unknown",
        cpu: p.monit?.cpu ?? 0,
        memory: p.monit?.memory ?? 0,
        uptime: p.pm2_env?.pm_uptime
          ? Math.floor((Date.now() - p.pm2_env.pm_uptime) / 1000)
          : 0,
        restarts: p.pm2_env?.restart_time ?? 0,
        port: p.pm2_env?.PORT ? parseInt(p.pm2_env.PORT, 10) : undefined,
        cwd,
        git: git || undefined,
      };
    }));
  } catch (err) {
    return [];
  }
}

const gitCache = new Map();
async function readGitInfo(cwd) {
  const cached = gitCache.get(cwd);
  if (cached && Date.now() - cached.ts < 30000) return cached.data;
  try {
    const [branch, log, status] = await Promise.all([
      execFileAsync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]).then((r) => r.stdout.trim()).catch(() => null),
      execFileAsync("git", ["-C", cwd, "log", "-1", "--pretty=%h%n%s"]).then((r) => r.stdout.trim().split("\n")).catch(() => null),
      execFileAsync("git", ["-C", cwd, "status", "--porcelain"]).then((r) => r.stdout.trim()).catch(() => ""),
    ]);
    const data = branch ? {
      branch,
      commit: log?.[0],
      commitMsg: log?.[1],
      dirty: status.length > 0,
    } : null;
    gitCache.set(cwd, { ts: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

// ---------- Komut çalıştırma (whitelist + rate limit) ----------

const cmdTimestamps = [];
function checkRateLimit() {
  const cutoff = Date.now() - 60_000;
  while (cmdTimestamps.length && cmdTimestamps[0] < cutoff) cmdTimestamps.shift();
  if (cmdTimestamps.length >= CMD_RATE_LIMIT_PER_MIN) {
    throw new Error(`rate limit: max ${CMD_RATE_LIMIT_PER_MIN} cmds/min`);
  }
  cmdTimestamps.push(Date.now());
}

async function runPm2Command(action, pm2Id) {
  if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
    throw new Error(`action not allowed: ${action}`);
  }
  // pm2Id KESİNLİKLE integer olmalı — shell injection'a karşı double check
  if (typeof pm2Id !== "number" || !Number.isInteger(pm2Id) || pm2Id < 0 || pm2Id > 9999) {
    throw new Error("invalid pm2Id");
  }
  checkRateLimit();

  const list = await readPm2List();
  const found = list.find((p) => p.pm2Id === pm2Id);
  if (!found) throw new Error(`process not found: ${pm2Id}`);

  // execFile ile, asla shell:true ile değil
  const { stdout, stderr } = await execFileAsync("pm2", [action, String(pm2Id)], {
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    shell: false,
  });
  console.log(`[cmd] ${action} pm2#${pm2Id} (${found.name})`);
  return (stdout + stderr).slice(-2000);
}

// ---------- Log streaming ----------

const logStreams = new Map(); // pm2Id -> child process

function startLogStream(pm2Id, send) {
  if (typeof pm2Id !== "number" || !Number.isInteger(pm2Id) || pm2Id < 0 || pm2Id > 9999) {
    return; // invalid id, sessizce reddet
  }
  if (!logStreams.has(pm2Id) && logStreams.size >= MAX_LOG_STREAMS) {
    return; // çok fazla concurrent stream
  }
  stopLogStream(pm2Id);
  const child = spawn("pm2", ["logs", String(pm2Id), "--raw", "--lines", "50"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  const onLine = (stream) => (chunk) => {
    chunk.toString().split("\n").filter(Boolean).forEach((line) => {
      send({ type: "log", pm2Id, stream, line: line.slice(0, 4000), ts: Date.now() });
    });
  };
  child.stdout.on("data", onLine("out"));
  child.stderr.on("data", onLine("err"));
  child.on("exit", () => logStreams.delete(pm2Id));
  logStreams.set(pm2Id, child);
}

function stopLogStream(pm2Id) {
  const child = logStreams.get(pm2Id);
  if (child) {
    child.kill("SIGTERM");
    logStreams.delete(pm2Id);
  }
}

function stopAllLogStreams() {
  for (const id of logStreams.keys()) stopLogStream(id);
}

// ---------- WS Client ----------

let ws = null;
let snapshotTimer = null;
let reconnectTimer = null;

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

async function sendSnapshot() {
  try {
    const [metrics, processes] = await Promise.all([readMetrics(), readPm2List()]);
    send({ type: "snapshot", ts: Date.now(), metrics, processes });
  } catch (err) {
    send({ type: "error", message: String(err?.message || err), context: "snapshot" });
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  console.log(`[agent] connecting to ${PANEL_URL}`);
  ws = new WebSocket(PANEL_URL, {
    headers: { "x-agent-token": AGENT_TOKEN, "x-agent-host": HOSTNAME },
    maxPayload: MAX_MESSAGE_SIZE,
    handshakeTimeout: 10_000,
  });

  let invalidCount = 0;

  ws.on("open", () => {
    console.log("[agent] connected");
    send({
      type: "hello",
      token: AGENT_TOKEN,
      hostname: HOSTNAME,
      os: `${os.type()} ${os.release()}`,
      cpuCores: os.cpus().length,
      totalMem: os.totalmem(),
      agentVersion: AGENT_VERSION,
    });
    sendSnapshot();
    snapshotTimer = setInterval(sendSnapshot, SNAPSHOT_INTERVAL_MS);
  });

  ws.on("message", async (data) => {
    // Boyut limiti — maxPayload zaten kapatır ama defense in depth
    if (data.length > MAX_MESSAGE_SIZE) {
      console.warn("[security] oversized message dropped");
      return;
    }

    let msg;
    try {
      msg = JSON.parse(data.toString("utf8"));
    } catch {
      if (++invalidCount > MAX_INVALID_MSGS) ws.close(4400, "too many invalid msgs");
      return;
    }

    if (!msg || typeof msg !== "object" || !ALLOWED_MSG_TYPES.has(msg.type)) {
      if (++invalidCount > MAX_INVALID_MSGS) ws.close(4400, "unknown message type");
      return;
    }

    if (msg.type === "ping") {
      send({ type: "pong" });
      return;
    }

    if (msg.type === "cmd") {
      if (typeof msg.id !== "string" || msg.id.length > 64) return;
      try {
        const output = await runPm2Command(msg.action, msg.pm2Id);
        send({ type: "cmd:ack", id: msg.id, success: true, output });
      } catch (err) {
        send({ type: "cmd:ack", id: msg.id, success: false, error: String(err?.message || err).slice(0, 500) });
      }
      return;
    }

    if (msg.type === "log:subscribe") {
      startLogStream(msg.pm2Id, send);
      return;
    }

    if (msg.type === "log:unsubscribe") {
      stopLogStream(msg.pm2Id);
      return;
    }
  });

  ws.on("close", () => {
    console.log("[agent] disconnected");
    clearInterval(snapshotTimer);
    stopAllLogStreams();
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    console.error("[agent] ws error:", err.message);
  });
}

process.on("SIGTERM", () => {
  stopAllLogStreams();
  if (ws) ws.close();
  process.exit(0);
});

(async () => {
  AGENT_TOKEN = await loadOrRegisterToken();
  console.log(`[agent] fingerprint=${FINGERPRINT.slice(0, 12)}…`);
  connect();
})();
