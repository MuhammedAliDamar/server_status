// Next.js → WS server arası HTTP istemcisi
const WS_HTTP = `http://127.0.0.1:${process.env.WS_PORT || 4000}`;
const SECRET = process.env.SESSION_SECRET || "dev-only-change-me";

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${WS_HTTP}${path}`, { headers: { "x-internal-secret": SECRET }, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type LiveState = {
  online: boolean;
  lastSeen: number;
  metrics: {
    cpu: number;
    cpuPerCore: number[];
    memUsed: number;
    memTotal: number;
    diskUsed: number;
    diskTotal: number;
    load1: number; load5: number; load15: number;
    netRx: number; netTx: number;
    uptime: number;
  } | null;
  processes: Array<{
    pm2Id: number;
    name: string;
    status: string;
    cpu: number;
    memory: number;
    uptime: number;
    restarts: number;
    port?: number;
    cwd?: string;
    git?: { branch?: string; commit?: string; commitMsg?: string; dirty?: boolean };
  }>;
  agentVersion?: string;
  os?: string;
};

export async function getAllLive(): Promise<Record<string, LiveState>> {
  return (await get<Record<string, LiveState>>("/live")) || {};
}

export async function getLive(serverId: string): Promise<LiveState | null> {
  return get<LiveState>(`/live/${serverId}`);
}

export async function sendCommand(
  serverId: string,
  payload: { id: string; action: "start" | "stop" | "restart"; pm2Id: number }
): Promise<{ success: boolean; error?: string; output?: string }> {
  try {
    const res = await fetch(`${WS_HTTP}/cmd/${serverId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": SECRET },
      body: JSON.stringify({ type: "cmd", ...payload }),
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
