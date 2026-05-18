// Alert engine — Slack webhook'a mesaj atar
// Tetikleyiciler: CPU/RAM threshold aşımı, agent offline, pm2 process error

import { prisma } from "./db";
import type { ServerLiveState } from "./agent-hub";

type AlertEvent =
  | { type: "agent_offline"; serverId: string; serverName: string }
  | { type: "agent_online"; serverId: string; serverName: string }
  | { type: "cpu_high"; serverId: string; serverName: string; value: number; threshold: number }
  | { type: "mem_high"; serverId: string; serverName: string; value: number; threshold: number }
  | { type: "disk_high"; serverId: string; serverName: string; value: number; threshold: number }
  | { type: "process_errored"; serverId: string; serverName: string; processName: string; status: string }
  | { type: "process_restarted"; serverId: string; serverName: string; processName: string; restarts: number };

// Aynı alarmı spam'leme — son atılma zamanını cache'le
const cooldown = new Map<string, number>();
const COOLDOWN_MS = 5 * 60 * 1000; // 5 dakika

async function getWebhookUrl(): Promise<string | null> {
  const env = process.env.SLACK_WEBHOOK_URL;
  if (env) return env;
  const setting = await prisma.settings.findUnique({ where: { key: "slack_webhook" } });
  return setting?.value || null;
}

function formatMessage(e: AlertEvent): { text: string; color: string } {
  switch (e.type) {
    case "agent_offline":
      return { text: `🔴 *${e.serverName}* agent OFFLINE`, color: "danger" };
    case "agent_online":
      return { text: `🟢 *${e.serverName}* agent online`, color: "good" };
    case "cpu_high":
      return { text: `⚠️ *${e.serverName}* CPU yüksek: %${e.value.toFixed(1)} (eşik %${e.threshold})`, color: "warning" };
    case "mem_high":
      return { text: `⚠️ *${e.serverName}* RAM yüksek: %${e.value.toFixed(1)} (eşik %${e.threshold})`, color: "warning" };
    case "disk_high":
      return { text: `⚠️ *${e.serverName}* DISK yüksek: %${e.value.toFixed(1)} (eşik %${e.threshold})`, color: "warning" };
    case "process_errored":
      return { text: `❌ *${e.serverName}* — \`${e.processName}\` durumda: ${e.status}`, color: "danger" };
    case "process_restarted":
      return { text: `🔁 *${e.serverName}* — \`${e.processName}\` yeniden başladı (toplam ${e.restarts}x)`, color: "warning" };
  }
}

async function send(e: AlertEvent) {
  const key = `${e.type}:${e.serverId}:${"processName" in e ? e.processName : ""}`;
  const last = cooldown.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return;
  cooldown.set(key, Date.now());

  const url = await getWebhookUrl();
  if (!url) {
    console.log("[alerts]", e.type, "(no slack webhook)");
    return;
  }

  const { text, color } = formatMessage(e);
  const payload = {
    attachments: [{ color, text, mrkdwn_in: ["text"], ts: Math.floor(Date.now() / 1000) }],
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[alerts] webhook failed:", err);
  }

  await prisma.auditLog.create({
    data: {
      serverId: e.serverId,
      action: `alert.${e.type}`,
      payload: JSON.stringify(e),
    },
  }).catch(() => {});
}

// Threshold tracking — state machine: high → fire, low → reset
const tripped = new Map<string, boolean>();

function checkThreshold(
  key: string,
  value: number,
  threshold: number,
  fire: () => void
) {
  const wasTripped = tripped.get(key) ?? false;
  const nowTripped = value > threshold;
  if (nowTripped && !wasTripped) {
    fire();
    tripped.set(key, true);
  } else if (!nowTripped && wasTripped) {
    tripped.set(key, false);
  }
}

const lastSeenOnline = new Map<string, boolean>();
const lastProcessStatus = new Map<string, string>();
const lastProcessRestarts = new Map<string, number>();

export async function checkState(state: ServerLiveState, serverName: string) {
  // Online/offline geçişi
  const wasOnline = lastSeenOnline.get(state.serverId) ?? false;
  if (state.online && !wasOnline) {
    if (lastSeenOnline.has(state.serverId)) {
      await send({ type: "agent_online", serverId: state.serverId, serverName });
    }
  } else if (!state.online && wasOnline) {
    await send({ type: "agent_offline", serverId: state.serverId, serverName });
  }
  lastSeenOnline.set(state.serverId, state.online);

  if (!state.online || !state.metrics) return;

  const m = state.metrics;
  checkThreshold(`cpu:${state.serverId}`, m.cpu, 85, () =>
    send({ type: "cpu_high", serverId: state.serverId, serverName, value: m.cpu, threshold: 85 })
  );
  const memPct = Number(m.memTotal) > 0 ? (Number(m.memUsed) / Number(m.memTotal)) * 100 : 0;
  checkThreshold(`mem:${state.serverId}`, memPct, 90, () =>
    send({ type: "mem_high", serverId: state.serverId, serverName, value: memPct, threshold: 90 })
  );
  const diskPct = Number(m.diskTotal) > 0 ? (Number(m.diskUsed) / Number(m.diskTotal)) * 100 : 0;
  checkThreshold(`disk:${state.serverId}`, diskPct, 90, () =>
    send({ type: "disk_high", serverId: state.serverId, serverName, value: diskPct, threshold: 90 })
  );

  for (const p of state.processes) {
    const key = `${state.serverId}:${p.pm2Id}`;
    const prevStatus = lastProcessStatus.get(key);
    if (prevStatus && prevStatus !== p.status && (p.status === "errored" || p.status === "stopped")) {
      await send({
        type: "process_errored",
        serverId: state.serverId,
        serverName,
        processName: p.name,
        status: p.status,
      });
    }
    lastProcessStatus.set(key, p.status);

    const prevRestarts = lastProcessRestarts.get(key) ?? p.restarts;
    if (p.restarts > prevRestarts) {
      await send({
        type: "process_restarted",
        serverId: state.serverId,
        serverName,
        processName: p.name,
        restarts: p.restarts,
      });
    }
    lastProcessRestarts.set(key, p.restarts);
  }
}

export async function sendTestAlert(): Promise<{ ok: boolean; error?: string }> {
  const url = await getWebhookUrl();
  if (!url) return { ok: false, error: "Slack webhook URL not configured" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "✅ Fleet Panel test alert — webhook çalışıyor",
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
