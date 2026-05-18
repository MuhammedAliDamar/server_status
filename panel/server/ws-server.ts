// Standalone WS+HTTP sunucu — agent'lar WS ile bağlanır, Next.js API HTTP ile state okur
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db";
import { agentHub } from "../lib/agent-hub";
import { checkState } from "../lib/alerts";
import type { AgentMessage } from "../lib/types";

const PORT = parseInt(process.env.WS_PORT || "4000", 10);
const INTERNAL_SECRET = process.env.SESSION_SECRET || "dev-only-change-me";

const agentSockets = new Map<string, WebSocket>();
const pendingCmds = new Map<string, (ack: { success: boolean; error?: string; output?: string }) => void>();

function sendCommand(serverId: string, msg: any): Promise<{ success: boolean; error?: string; output?: string }> {
  const ws = agentSockets.get(serverId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve({ success: false, error: "agent offline" });
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingCmds.delete(msg.id);
      resolve({ success: false, error: "command timeout" });
    }, 15000);
    pendingCmds.set(msg.id, (ack) => {
      clearTimeout(timeout);
      pendingCmds.delete(msg.id);
      resolve(ack);
    });
    ws.send(JSON.stringify(msg));
  });
}

// ---------- HTTP (panel internal) ----------

function authOk(req: http.IncomingMessage): boolean {
  return req.headers["x-internal-secret"] === INTERNAL_SECRET;
}

function liveStateForServer(serverId: string) {
  const s = agentHub.get(serverId);
  if (!s) return null;
  return {
    online: s.online,
    lastSeen: s.lastSeen,
    metrics: s.metrics ? {
      ...s.metrics,
      memUsed: Number(s.metrics.memUsed),
      memTotal: Number(s.metrics.memTotal),
      diskUsed: Number(s.metrics.diskUsed),
      diskTotal: Number(s.metrics.diskTotal),
      netRx: Number(s.metrics.netRx),
      netTx: Number(s.metrics.netTx),
    } : null,
    processes: s.processes,
    agentVersion: s.agentVersion,
    os: s.os,
  };
}

const httpServer = http.createServer(async (req, res) => {
  if (!authOk(req)) {
    res.writeHead(401).end("unauthorized");
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/live") {
    const states: Record<string, ReturnType<typeof liveStateForServer>> = {};
    for (const s of agentHub.getAll()) states[s.serverId] = liveStateForServer(s.serverId);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(states));
    return;
  }

  const liveMatch = url.pathname.match(/^\/live\/([^/]+)$/);
  if (req.method === "GET" && liveMatch) {
    const state = liveStateForServer(liveMatch[1]);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(state));
    return;
  }

  // SSE log stream — Next.js bu endpoint'i client'a proxy'ler
  const logMatch = url.pathname.match(/^\/logs\/([^/]+)\/(\d+)$/);
  if (req.method === "GET" && logMatch) {
    const [, serverId, pm2IdStr] = logMatch;
    const pm2Id = parseInt(pm2IdStr, 10);
    const ws = agentSockets.get(serverId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      res.writeHead(503).end("agent offline");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    ws.send(JSON.stringify({ type: "log:subscribe", pm2Id, lines: 100 }));
    const unsub = agentHub.subscribeLog(serverId, pm2Id, (log) => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    });
    const keepalive = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(keepalive);
      unsub();
      const stillSub = agentHub.hasLogSubscribers(serverId, pm2Id);
      if (!stillSub && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "log:unsubscribe", pm2Id }));
      }
    });
    return;
  }

  const cmdMatch = url.pathname.match(/^\/cmd\/([^/]+)$/);
  if (req.method === "POST" && cmdMatch) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const msg = JSON.parse(body);
        const result = await sendCommand(cmdMatch[1], msg);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400).end(JSON.stringify({ success: false, error: String(err) }));
      }
    });
    return;
  }

  res.writeHead(404).end("not found");
});

// ---------- WS (agents) ----------

const wss = new WebSocketServer({ server: httpServer, path: "/agent" });

wss.on("connection", async (ws, req) => {
  const token = req.headers["x-agent-token"] as string | undefined;
  const host = req.headers["x-agent-host"] as string | undefined;
  if (!token) return ws.close(4001, "missing token");

  const servers = await prisma.server.findMany({ where: { active: true } });
  let matched: typeof servers[number] | null = null;
  for (const s of servers) {
    if (await bcrypt.compare(token, s.tokenHash)) { matched = s; break; }
  }
  if (!matched) return ws.close(4003, "invalid token");

  const serverId = matched.id;
  const serverName = matched.name;
  console.log(`[ws] agent connected: ${serverName} (${host})`);

  const old = agentSockets.get(serverId);
  if (old && old !== ws) old.close(4008, "replaced");
  agentSockets.set(serverId, ws);

  ws.on("message", async (data) => {
    let msg: AgentMessage & { type: string };
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === "hello") {
      const m = msg as any;
      await prisma.server.update({
        where: { id: serverId },
        data: { os: m.os, cpuCores: m.cpuCores, totalMem: BigInt(m.totalMem), lastSeenAt: new Date(), host: m.hostname },
      });
      agentHub.setOnline(serverId, { agentVersion: m.agentVersion, os: m.os });
    } else if (msg.type === "snapshot") {
      agentHub.recordSnapshot(serverId, msg as any);
      prisma.server.update({ where: { id: serverId }, data: { lastSeenAt: new Date() } }).catch(() => {});
      const state = agentHub.get(serverId);
      if (state) checkState(state, serverName).catch((e) => console.error("[alerts]", e));
    } else if (msg.type === "log") {
      agentHub.dispatchLog(serverId, msg as any);
    } else if (msg.type === "cmd:ack") {
      const m = msg as any;
      const r = pendingCmds.get(m.id);
      if (r) r({ success: m.success, error: m.error, output: m.output });
    }
  });

  ws.on("close", () => {
    console.log(`[ws] agent disconnected: ${serverName}`);
    if (agentSockets.get(serverId) === ws) {
      agentSockets.delete(serverId);
      agentHub.setOffline(serverId);
    }
  });

  ws.on("error", (err) => console.error(`[ws] error ${serverName}:`, err.message));
});

setInterval(() => {
  const now = Date.now();
  for (const state of agentHub.getAll()) {
    if (state.online && now - state.lastSeen > 10000) agentHub.setOffline(state.serverId);
  }
}, 5000);

httpServer.listen(PORT, () => console.log(`[ws+http] listening on :${PORT} (agents → ws://host:${PORT}/agent)`));

process.on("SIGTERM", () => { wss.close(); httpServer.close(); process.exit(0); });
