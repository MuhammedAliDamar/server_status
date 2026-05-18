// Paylaşılan tipler — agent ve panel arasında protokol

export type AgentHello = {
  type: "hello";
  token: string;
  hostname: string;
  os: string;
  cpuCores: number;
  totalMem: number;
  agentVersion: string;
};

export type ProcessInfo = {
  pm2Id: number;
  name: string;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  port?: number;
  cwd?: string;
  git?: {
    branch?: string;
    commit?: string;
    commitMsg?: string;
    dirty?: boolean;
  };
};

export type Metrics = {
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
};

export type AgentSnapshot = {
  type: "snapshot";
  ts: number;
  metrics: Metrics;
  processes: ProcessInfo[];
};

export type AgentLog = {
  type: "log";
  pm2Id: number;
  stream: "out" | "err";
  line: string;
  ts: number;
};

export type AgentError = {
  type: "error";
  message: string;
  context?: string;
};

export type AgentMessage = AgentHello | AgentSnapshot | AgentLog | AgentError;

// Panel → Agent
export type CmdMessage =
  | { type: "cmd"; id: string; action: "start" | "stop" | "restart"; pm2Id: number }
  | { type: "log:subscribe"; pm2Id: number; lines?: number }
  | { type: "log:unsubscribe"; pm2Id: number }
  | { type: "ping" };

export type CmdAck = {
  type: "cmd:ack";
  id: string;
  success: boolean;
  error?: string;
  output?: string;
};
