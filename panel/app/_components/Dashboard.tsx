"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBytes, formatUptime, relativeTime } from "@/lib/utils";
import AddServerDialog from "./AddServerDialog";

type ServerCard = {
  id: string;
  name: string;
  label: string | null;
  host: string | null;
  publicIp: string | null;
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
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);

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
                  <span className={onlineCount === servers.length ? "text-green-500" : "text-yellow-500"}>●</span>{" "}
                  {onlineCount}/{servers.length} online
                </>
              ) : (
                "no servers"
              )}
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
              <ServerCardView
                key={s.id}
                server={s}
                onRefresh={load}
                onEdit={() => setEditing({ id: s.id, label: s.label || s.name })}
              />
            ))}
          </div>
        )}
      </main>

      <AddServerDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={load} />

      {editing && (
        <EditLabelDialog
          serverId={editing.id}
          initialLabel={editing.label}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
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

function ServerCardView({
  server,
  onRefresh,
  onEdit,
}: {
  server: ServerCard;
  onRefresh: () => void;
  onEdit: () => void;
}) {
  async function deleteServer(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const title = server.label || server.name;
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    await fetch(`/api/servers/${server.id}`, { method: "DELETE" });
    onRefresh();
  }

  function startEdit(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onEdit();
  }

  const m = server.metrics;
  const memPct = m && m.memTotal > 0 ? (m.memUsed / m.memTotal) * 100 : 0;
  const diskPct = m && m.diskTotal > 0 ? (m.diskUsed / m.diskTotal) * 100 : 0;
  const title = server.label || server.name;

  return (
    <Link
      href={`/servers/${server.id}`}
      className="block bg-card border border-border rounded-xl p-4 hover:border-accent/30 transition"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={server.online ? "text-green-500" : "text-zinc-400"}>●</span>
            <h3 className="font-semibold truncate">{title}</h3>
            <button
              onClick={startEdit}
              className="opacity-30 hover:opacity-100 text-xs text-muted-foreground"
              title="Rename"
            >
              ✎
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
            {server.publicIp && <span>{server.publicIp}</span>}
            {server.publicIp && server.host && <span className="mx-1">·</span>}
            {server.host && <span>{server.host}</span>}
            {server.os && <span className="ml-1">· {server.os.split(" ")[0]}</span>}
          </p>
        </div>
        <button
          onClick={deleteServer}
          className="text-xs text-muted-foreground hover:text-red-500 opacity-50 hover:opacity-100 ml-2"
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

function EditLabelDialog({
  serverId,
  initialLabel,
  onClose,
  onSaved,
}: {
  serverId: string;
  initialLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(initialLabel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/servers/${serverId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: value.trim() }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-md p-6 mx-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Rename Server</h2>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            else if (e.key === "Escape") onClose();
          }}
          autoFocus
          maxLength={120}
          className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        {error && <div className="text-sm text-red-500 mt-2">{error}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-md border border-border hover:bg-muted">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !value.trim() || value.trim() === initialLabel}
            className="px-3 py-2 text-sm rounded-md bg-accent text-background font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
