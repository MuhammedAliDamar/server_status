"use client";

import { useState } from "react";

export default function AddServerDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ id: string; name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    setLoading(false);
    if (res.ok) {
      const data = await res.json();
      setResult(data);
      onCreated();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to create");
    }
  }

  function close() {
    setName("");
    setDescription("");
    setError("");
    setResult(null);
    onClose();
  }

  const panelHost = typeof window !== "undefined" ? window.location.hostname : "panel.local";
  const installCmd = result
    ? `PANEL_URL="ws://${panelHost}:4000" AGENT_TOKEN="${result.token}" node agent.js`
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={close}>
      <div className="bg-card border border-border rounded-xl w-full max-w-lg p-6 mx-4" onClick={(e) => e.stopPropagation()}>
        {!result ? (
          <form onSubmit={submit} className="space-y-4">
            <h2 className="text-lg font-semibold">Add Server</h2>
            <div>
              <label className="text-sm font-medium block mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="srv1563475"
                autoFocus
                required
                className="w-full px-3 py-2 rounded-md border border-border bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              <p className="text-xs text-muted-foreground mt-1">Alphanumeric, dash, dot, underscore</p>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Description (optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Main production VPS"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            {error && <div className="text-sm text-red-500">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={close} className="px-3 py-2 text-sm rounded-md border border-border hover:bg-muted">Cancel</button>
              <button type="submit" disabled={loading} className="px-3 py-2 text-sm rounded-md bg-accent text-background font-medium hover:opacity-90 disabled:opacity-50">
                {loading ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Server created: {result.name}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Copy the agent setup command below. The token is shown <strong>only once</strong>.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Token</label>
              <div className="flex gap-2">
                <code className="flex-1 px-3 py-2 rounded-md border border-border bg-muted font-mono text-xs break-all">
                  {result.token}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(result.token);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="px-3 py-2 text-sm rounded-md border border-border hover:bg-muted shrink-0"
                >
                  {copied ? "✓" : "Copy"}
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Run on target server</label>
              <code className="block px-3 py-3 rounded-md border border-border bg-muted font-mono text-xs whitespace-pre-wrap break-all">
                {installCmd}
              </code>
              <p className="text-xs text-muted-foreground mt-2">
                See <code className="font-mono">agent/README.md</code> for systemd setup.
              </p>
            </div>
            <div className="flex justify-end">
              <button onClick={close} className="px-3 py-2 text-sm rounded-md bg-accent text-background font-medium hover:opacity-90">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
