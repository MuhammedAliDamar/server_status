"use client";

import { useEffect, useRef, useState } from "react";

type LogLine = {
  pm2Id: number;
  stream: "out" | "err";
  line: string;
  ts: number;
};

export default function LogDrawer({
  serverId,
  pm2Id,
  processName,
  onClose,
}: {
  serverId: string;
  pm2Id: number;
  processName: string;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState<"all" | "err">("all");
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const es = new EventSource(`/api/servers/${serverId}/logs/${pm2Id}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      if (pausedRef.current) return;
      try {
        const log = JSON.parse(e.data) as LogLine;
        setLines((prev) => {
          const next = [...prev, log];
          return next.length > 1000 ? next.slice(-1000) : next;
        });
      } catch {}
    };
    return () => es.close();
  }, [serverId, pm2Id]);

  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, paused]);

  const visible = filter === "err" ? lines.filter((l) => l.stream === "err") : lines;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border-l border-border w-full max-w-3xl h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold">
              <span className={connected ? "text-green-500" : "text-zinc-400"}>●</span>{" "}
              {processName} <span className="text-xs text-muted-foreground font-mono">#{pm2Id}</span>
            </h2>
            <p className="text-xs text-muted-foreground">{visible.length} lines · live</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
              <button
                onClick={() => setFilter("all")}
                className={`px-2 py-1 ${filter === "all" ? "bg-muted" : ""}`}
              >
                all
              </button>
              <button
                onClick={() => setFilter("err")}
                className={`px-2 py-1 border-l border-border ${filter === "err" ? "bg-muted" : ""}`}
              >
                err
              </button>
            </div>
            <button
              onClick={() => setPaused((p) => !p)}
              className="text-xs px-2 py-1 rounded-md border border-border hover:bg-muted"
            >
              {paused ? "▶ resume" : "⏸ pause"}
            </button>
            <button onClick={() => setLines([])} className="text-xs px-2 py-1 rounded-md border border-border hover:bg-muted">
              clear
            </button>
            <button onClick={onClose} className="text-xs px-2 py-1 rounded-md border border-border hover:bg-muted">
              ✕
            </button>
          </div>
        </header>
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto bg-zinc-950 text-zinc-100 font-mono text-xs p-3 space-y-0.5"
        >
          {visible.length === 0 ? (
            <div className="text-zinc-500 text-center py-8">Waiting for log lines…</div>
          ) : (
            visible.map((l, i) => (
              <div key={i} className={l.stream === "err" ? "text-red-400" : "text-zinc-300"}>
                <span className="text-zinc-500 mr-2">{new Date(l.ts).toLocaleTimeString()}</span>
                {l.line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
