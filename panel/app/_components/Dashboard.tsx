"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBytes, formatUptime, relativeTime } from "@/lib/utils";
import AddServerDialog from "./AddServerDialog";

type ServerCard = {
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
    memUsed: number;
    memTotal: number;
    diskUsed: number;
    diskTotal: number;
    uptime: number;
  } | null;
  processCount: number;
};

export default function Dashboard() {
  const [servers, setServers] = useState<ServerCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/servers");
      if (res.ok) setServers(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, []);

  const onlineCount = servers.filter((s) => s.online).length;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border sticky top-0 z-10 bg-background/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight">Fleet Panel</h1>
            <span className="text-xs text-muted-foreground">
              {servers.length > 0 ? (
                <>
                  <span className={onlineCount === servers.length ? "text-green-500" : "text-yellow-500"}>●</span> {onlineCount}/{servers.length} online
                </>
              ) : "no servers"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddOpen(true)}
              className="text-sm px-3 py-1.5 rounded-md bg-accent text-background hover:opacity-90 font-medium"
            >
              + Add Server
            </button>
            <button
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                location.href = "/login";
              }}
              className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {loading ? (
          <div className="text-center text-muted-foreground py-12">Loading…</div>
        ) : servers.length === 0 ? (
          <EmptyState onAdd={() => setAddOpen(true)} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {servers.map((s) => (
              <ServerCardView key={s.id} server={s} onRefresh={load} />
            ))}
          </div>
        )}
      </main>

      <AddServerDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={load} />
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="border-2 border-dashed border-border rounded-xl p-16 text-center">
      <h2 className="text-lg font-medium mb-2">No servers yet</h2>
      <p className="text-sm text-muted-foreground mb-4">Add your first server to start monitoring</p>
      <button
        onClick={onAdd}
        className="text-sm px-4 py-2 rounded-md bg-accent text-background font-medium hover:opacity-90"
      >
        + Add Server
      </button>
    </div>
  );
}

function ServerCardView({ server, onRefresh }: { server: ServerCard; onRefresh: () => void }) {
  async function deleteServer(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${server.name}"? This cannot be undone.`)) return;
    await fetch(`/api/servers/${server.id}`, { method: "DELETE" });
    onRefresh();
  }

  const m = server.metrics;
  const memPct = m && m.memTotal > 0 ? (m.memUsed / m.memTotal) * 100 : 0;
  const diskPct = m && m.diskTotal > 0 ? (m.diskUsed / m.diskTotal) * 100 : 0;

  return (
    <Link
      href={`/servers/${server.id}`}
      className="block bg-card border border-border rounded-xl p-4 hover:border-accent/30 transition"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={server.online ? "text-green-500" : "text-zinc-400"}>●</span>
            <h3 className="font-semibold truncate">{server.name}</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {server.host || "—"} {server.os && `· ${server.os.split(" ")[0]}`}
          </p>
        </div>
        <button
          onClick={deleteServer}
          className="text-xs text-muted-foreground hover:text-red-500 opacity-50 hover:opacity-100"
          title="Delete"
        >
          ✕
        </button>
      </div>

      {m ? (
        <div className="space-y-2">
          <MetricBar label="CPU" pct={m.cpu} value={`${m.cpu.toFixed(1)}%`} />
          <MetricBar label="RAM" pct={memPct} value={`${formatBytes(m.memUsed)} / ${formatBytes(m.memTotal)}`} />
          <MetricBar label="Disk" pct={diskPct} value={`${formatBytes(m.diskUsed)} / ${formatBytes(m.diskTotal)}`} />
          <div className="flex justify-between text-xs text-muted-foreground pt-1">
            <span>{server.processCount} processes</span>
            <span>up {formatUptime(m.uptime)}</span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground py-2">
          {server.lastSeenAt ? `Last seen ${relativeTime(server.lastSeenAt)}` : "Waiting for agent…"}
        </div>
      )}
    </Link>
  );
}

function MetricBar({ label, pct, value }: { label: string; pct: number; value: string }) {
  const color = pct > 90 ? "bg-red-500" : pct > 75 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}
