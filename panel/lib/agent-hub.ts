// Agent hub — in-memory state ve event bus
// WS sunucusu agent'lardan gelen verileri buraya yazar
// API/UI buradan okur

import { EventEmitter } from "node:events";
import type { AgentSnapshot, AgentLog, ProcessInfo, Metrics } from "./types";

export type ServerLiveState = {
  serverId: string;
  online: boolean;
  lastSeen: number;
  metrics?: Metrics;
  processes: ProcessInfo[];
  agentVersion?: string;
  os?: string;
};

class AgentHub extends EventEmitter {
  private state = new Map<string, ServerLiveState>();
  private logSubscribers = new Map<string, Set<(log: AgentLog) => void>>(); // serverId:pm2Id -> handlers

  setOnline(serverId: string, info: Partial<ServerLiveState>) {
    const cur = this.state.get(serverId) ?? {
      serverId,
      online: false,
      lastSeen: 0,
      processes: [],
    };
    const next: ServerLiveState = {
      ...cur,
      ...info,
      serverId,
      online: true,
      lastSeen: Date.now(),
    };
    this.state.set(serverId, next);
    this.emit("update", next);
  }

  setOffline(serverId: string) {
    const cur = this.state.get(serverId);
    if (!cur) return;
    cur.online = false;
    this.emit("update", cur);
  }

  recordSnapshot(serverId: string, snap: AgentSnapshot) {
    this.setOnline(serverId, {
      metrics: snap.metrics,
      processes: snap.processes,
      lastSeen: snap.ts,
    });
  }

  get(serverId: string): ServerLiveState | undefined {
    return this.state.get(serverId);
  }

  getAll(): ServerLiveState[] {
    return Array.from(this.state.values());
  }

  // Log subscription
  subscribeLog(serverId: string, pm2Id: number, handler: (log: AgentLog) => void): () => void {
    const key = `${serverId}:${pm2Id}`;
    if (!this.logSubscribers.has(key)) this.logSubscribers.set(key, new Set());
    this.logSubscribers.get(key)!.add(handler);
    return () => {
      const set = this.logSubscribers.get(key);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) {
        this.logSubscribers.delete(key);
        this.emit("log:unsubscribe", { serverId, pm2Id });
      }
    };
  }

  hasLogSubscribers(serverId: string, pm2Id: number): boolean {
    return (this.logSubscribers.get(`${serverId}:${pm2Id}`)?.size ?? 0) > 0;
  }

  dispatchLog(serverId: string, log: AgentLog) {
    const set = this.logSubscribers.get(`${serverId}:${log.pm2Id}`);
    if (!set) return;
    for (const h of set) h(log);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __agentHub: AgentHub | undefined;
}

export const agentHub = globalThis.__agentHub ?? (globalThis.__agentHub = new AgentHub());
