-- CreateTable
CREATE TABLE "Server" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "host" TEXT,
    "description" TEXT,
    "tokenHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" DATETIME,
    "os" TEXT,
    "cpuCores" INTEGER,
    "totalMem" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Process" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "pm2Id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cpu" REAL NOT NULL DEFAULT 0,
    "memory" BIGINT NOT NULL DEFAULT 0,
    "uptime" BIGINT NOT NULL DEFAULT 0,
    "restarts" INTEGER NOT NULL DEFAULT 0,
    "port" INTEGER,
    "cwd" TEXT,
    "gitBranch" TEXT,
    "gitCommit" TEXT,
    "gitCommitMsg" TEXT,
    "gitDirty" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Process_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "cpu" REAL NOT NULL,
    "memUsed" BIGINT NOT NULL,
    "memTotal" BIGINT NOT NULL,
    "diskUsed" BIGINT NOT NULL,
    "diskTotal" BIGINT NOT NULL,
    "load1" REAL NOT NULL,
    "load5" REAL NOT NULL,
    "load15" REAL NOT NULL,
    "netRx" BIGINT NOT NULL DEFAULT 0,
    "netTx" BIGINT NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetricSnapshot_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "payload" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT,
    "type" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertRule_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Server_name_key" ON "Server"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Process_serverId_pm2Id_key" ON "Process"("serverId", "pm2Id");

-- CreateIndex
CREATE INDEX "MetricSnapshot_serverId_createdAt_idx" ON "MetricSnapshot"("serverId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
