"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBytes, formatUptime, relativeTime } from "@/lib/utils";
import LogDrawer from "./LogDrawer";

type Detail = {
  id: string;
  name: string;
  host: string | null;
  description: string | null;
  active: boolean;
  lastSeenAt: string | null;
  os: string | null;
  cpuCores: number | null;
  totalMem: number | null;
  online: boolean;
  metrics: {
    cpu: number;
    cpuPerCore: number[];
    memUsed: number;
    memTotal: number;
    diskUsed: number;
    diskTotal: number;
    load1: number;
    load5: number;
    load15: number;
    netRx: number;
    netTx: number;
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
};

export default function ServerDetail({ serverId, serverName }: { serverId: string; serverName: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<{ pm2Id: number; name: string } | null>(null);

  async function load() {
    const res = await fetch(`/api/servers/${serverId}`);
    if (res.ok) setData(await res.json());
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 1500);
    return () => clearInterval(id);
  }, [serverId]);

  async function runCommand(action: "start" | "stop" | "restart", pm2Id: number, processName: string) {
    if (!confirm(`${action.toUpperCase()} "${processName}" (pm2 id ${pm2Id})?`)) return;
    setBusy(`${action}:${pm2Id}`);
    const res = await fetch(`/api/servers/${serverId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, pm2Id }),
    });
    const result = await res.json();
    setBusy(null);
    if (!result.success) alert(`Command failed: ${result.error || "unknown"}`);
    load();
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  const m = data.metrics;
  const memPct = m && m.memTotal > 0 ? (m.memUsed / m.memTotal) * 100 : 0;
  const diskPct = m && m.diskTotal > 0 ? (m.diskUsed / m.diskTotal) * 100 : 0;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border sticky top-0 z-10 bg-background/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
            <div className="flex items-center gap-2">
              <span className={data.online ? "text-green-500" : "text-zinc-400"}>●</span>
              <h1 className="text-lg font-semibold tracking-tight">{data.name}</h1>
              <span className="text-xs text-muted-foreground">
                {data.host} {data.os && `· ${data.os}`} {data.cpuCores && `· ${data.cpuCores} cores`}
              </span>
            </div>
          </div>
          {!data.online && (
            <span className="text-xs text-red-500">
              offline · last seen {relativeTime(data.lastSeenAt)}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {m && (
          <section className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">System</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-xs text-muted-foreground mb-2">CPU per core</div>
                <div className="grid grid-cols-8 gap-1">
                  {m.cpuPerCore.map((v, i) => (
                    <div key={i} className="text-center">
                      <div className="h-16 bg-muted rounded flex flex-col justify-end overflow-hidden">
                        <div
                          className={v > 80 ? "bg-red-500" : v > 50 ? "bg-yellow-500" : "bg-green-500"}
                          style={{ height: `${v}%` }}
                        />
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-1">{v.toFixed(0)}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  Load: <span className="font-mono">{m.load1.toFixed(2)} {m.load5.toFixed(2)} {m.load15.toFixed(2)}</span>
                </div>
              </div>
              <div className="space-y-3">
                <Bar label="Memory" pct={memPct} value={`${formatBytes(m.memUsed)} / ${formatBytes(m.memTotal)}`} />
                <Bar label="Disk" pct={diskPct} value={`${formatBytes(m.diskUsed)} / ${formatBytes(m.diskTotal)}`} />
                <div className="flex justify-between text-xs text-muted-foreground pt-1">
                  <span>Network ↓ {formatBytes(m.netRx)}/s ↑ {formatBytes(m.netTx)}/s</span>
                  <span>up {formatUptime(m.uptime)}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Processes (PM2)</h2>
            <span className="text-xs text-muted-foreground">{data.processes.length} total</span>
          </div>
          {data.processes.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              {data.online ? "No PM2 processes" : "Agent offline"}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="text-left px-5 py-2 font-medium">#</th>
                  <th className="text-left px-2 py-2 font-medium">Name</th>
                  <th className="text-left px-2 py-2 font-medium">Status</th>
                  <th className="text-right px-2 py-2 font-medium">CPU</th>
                  <th className="text-right px-2 py-2 font-medium">RAM</th>
                  <th className="text-right px-2 py-2 font-medium">Uptime</th>
                  <th className="text-right px-2 py-2 font-medium">↻</th>
                  <th className="text-left px-2 py-2 font-medium">Git</th>
                  <th className="text-right px-5 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.processes.map((p) => (
                  <tr key={p.pm2Id} className="border-t border-border">
                    <td className="px-5 py-3 font-mono text-xs">{p.pm2Id}</td>
                    <td className="px-2 py-3 font-medium">
                      {p.name}
                      {p.port && <span className="text-xs text-muted-foreground ml-2 font-mono">:{p.port}</span>}
                    </td>
                    <td className="px-2 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-2 py-3 text-right font-mono text-xs">{p.cpu}%</td>
                    <td className="px-2 py-3 text-right font-mono text-xs">{formatBytes(p.memory)}</td>
                    <td className="px-2 py-3 text-right font-mono text-xs">{p.status === "online" ? formatUptime(p.uptime) : "—"}</td>
                    <td className="px-2 py-3 text-right font-mono text-xs">{p.restarts}</td>
                    <td className="px-2 py-3 text-xs">
                      {p.git ? (
                        <span title={p.git.commitMsg}>
                          <span className="font-mono">{p.git.branch}</span>
                          {p.git.dirty && <span className="text-yellow-500 ml-1">●</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <ActionBtn label="≡" title="Logs" busy={false} onClick={() => setLogFor({ pm2Id: p.pm2Id, name: p.name })} />
                        <ActionBtn label="▶" title="Start" busy={busy === `start:${p.pm2Id}`} onClick={() => runCommand("start", p.pm2Id, p.name)} />
                        <ActionBtn label="⏸" title="Stop" busy={busy === `stop:${p.pm2Id}`} onClick={() => runCommand("stop", p.pm2Id, p.name)} />
                        <ActionBtn label="↻" title="Restart" busy={busy === `restart:${p.pm2Id}`} onClick={() => runCommand("restart", p.pm2Id, p.name)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>

      {logFor && (
        <LogDrawer
          serverId={serverId}
          pm2Id={logFor.pm2Id}
          processName={logFor.name}
          onClose={() => setLogFor(null)}
        />
      )}
    </div>
  );
}

function Bar({ label, pct, value }: { label: string; pct: number; value: string }) {
  const color = pct > 90 ? "bg-red-500" : pct > 75 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: "bg-green-500/10 text-green-600 dark:text-green-400",
    stopped: "bg-zinc-500/10 text-zinc-500",
    errored: "bg-red-500/10 text-red-500",
    launching: "bg-yellow-500/10 text-yellow-500",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function ActionBtn({ label, title, busy, onClick }: { label: string; title: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      className="w-7 h-7 inline-flex items-center justify-center rounded border border-border hover:bg-muted text-xs disabled:opacity-50"
    >
      {busy ? "…" : label}
    </button>
  );
}
