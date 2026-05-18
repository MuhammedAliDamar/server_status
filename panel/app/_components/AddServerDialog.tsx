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
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ id: string; name: string; label: string; token: string; installCommand: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, description }),
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
    setLabel("");
    setDescription("");
    setError("");
    setResult(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={close}>
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl p-6 mx-4" onClick={(e) => e.stopPropagation()}>
        {!result ? (
          <form onSubmit={submit} className="space-y-4">
            <h2 className="text-lg font-semibold">Add Server</h2>
            <div>
              <label className="text-sm font-medium block mb-1.5">Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ana Sunucu, Sunucu 2, Production Web…"
                autoFocus
                required
                maxLength={120}
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              <p className="text-xs text-muted-foreground mt-1">Anlamlı bir isim ver — dashboard'da bu görünecek.</p>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Açıklama (opsiyonel)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Production VPS, Hetzner CX21…"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            {error && <div className="text-sm text-red-500">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={close} className="px-3 py-2 text-sm rounded-md border border-border hover:bg-muted">Cancel</button>
              <button type="submit" disabled={loading || !label.trim()} className="px-3 py-2 text-sm rounded-md bg-accent text-background font-medium hover:opacity-90 disabled:opacity-50">
                {loading ? "Oluşturuluyor…" : "Create + Get command"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">✅ {result.label}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Aşağıdaki komutu izlemek istediğin sunucuda <strong>root olarak</strong> çalıştır.
                Token sadece bu sefer gösteriliyor.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Install command</label>
              <div className="relative">
                <pre className="px-3 py-3 pr-20 rounded-md border border-border bg-zinc-950 text-zinc-100 font-mono text-xs whitespace-pre-wrap break-all max-h-48 overflow-auto">
                  {result.installCommand}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(result.installCommand);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="absolute top-2 right-2 px-3 py-1 text-xs rounded-md bg-accent text-background font-medium hover:opacity-90"
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Token'ı tek başına gör</summary>
              <code className="block mt-2 px-3 py-2 rounded-md border border-border bg-muted font-mono text-xs break-all">
                {result.token}
              </code>
            </details>

            <p className="text-xs text-muted-foreground">
              💡 Agent başarıyla bağlandığında dashboard'da <strong>{result.label}</strong> kartı 🟢 yeşil yanacak.
            </p>

            <div className="flex justify-end">
              <button onClick={close} className="px-3 py-2 text-sm rounded-md bg-accent text-background font-medium hover:opacity-90">Tamam</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
