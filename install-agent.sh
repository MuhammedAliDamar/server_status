#!/usr/bin/env bash
# fleet-agent installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/MuhammedAliDamar/server_status/main/install-agent.sh | \
#     sudo bash -s -- --panel ws://panel.example.com:4000 --token flt_xxx
#
# Veya interaktif (değer sorar):
#   curl -fsSL https://raw.githubusercontent.com/MuhammedAliDamar/server_status/main/install-agent.sh | sudo bash

set -euo pipefail

# ---------- argümanlar ----------
PANEL_URL=""
AGENT_TOKEN=""
HOSTNAME_ARG=""
INSTALL_DIR="/opt/fleet-agent"
SERVICE_NAME="fleet-agent"
REPO_RAW="https://raw.githubusercontent.com/MuhammedAliDamar/server_status/main"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --panel|-p) PANEL_URL="$2"; shift 2 ;;
    --token|-t) AGENT_TOKEN="$2"; shift 2 ;;
    --hostname|-h) HOSTNAME_ARG="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --service-name) SERVICE_NAME="$2"; shift 2 ;;
    --help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# ---------- ortam kontrolleri ----------
if [[ $EUID -ne 0 ]]; then
  echo "[!] Bu script root olarak çalışmalı (sudo)" >&2
  exit 1
fi

if [[ -z "$PANEL_URL" ]]; then
  read -rp "Panel WS URL (örn: ws://panel.example.com:4000): " PANEL_URL
fi
if [[ -z "$AGENT_TOKEN" ]]; then
  read -rsp "Agent token (panel'den aldığın flt_...): " AGENT_TOKEN
  echo
fi

# Token format kontrolü
if [[ ! "$AGENT_TOKEN" =~ ^flt_[A-Za-z0-9]{30,80}$ ]]; then
  echo "[!] Token formatı geçersiz (flt_ ile başlamalı, alfanumerik 30-80 karakter)" >&2
  exit 1
fi

# Panel URL'de wss:// kullanmaya teşvik et
if [[ "$PANEL_URL" =~ ^ws:// && ! "$PANEL_URL" =~ ^ws://(localhost|127\.0\.0\.1) ]]; then
  echo "[uyarı] Plain ws:// — token şifresiz iletilir. Production'da wss:// kullan."
fi

echo "==> Fleet Agent kurulumu başlıyor"
echo "    Panel URL : $PANEL_URL"
echo "    Hedef dir : $INSTALL_DIR"
echo "    Service   : $SERVICE_NAME"
echo

# ---------- Node.js (≥18) ----------
NODE_OK=false
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node -p "process.versions.node.split('.')[0]")
  if [[ "$NODE_VER" -ge 18 ]]; then
    NODE_OK=true
  fi
fi

if ! $NODE_OK; then
  echo "==> Node.js 20 kuruluyor"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache nodejs npm
  else
    echo "[!] apt/yum/apk bulunamadı. Node.js 18+'ı manuel kur." >&2
    exit 1
  fi
fi

# ---------- agent dosyalarını indir ----------
echo "==> Agent indiriliyor"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

curl -fsSL "$REPO_RAW/agent/agent.js" -o agent.js
curl -fsSL "$REPO_RAW/agent/package.json" -o package.json

echo "==> Bağımlılıklar kuruluyor"
npm install --omit=dev --no-audit --no-fund

# ---------- ayrı user (least privilege) ----------
if ! id -u fleet-agent >/dev/null 2>&1; then
  echo "==> 'fleet-agent' kullanıcısı oluşturuluyor"
  useradd --system --no-create-home --shell /usr/sbin/nologin fleet-agent || \
    useradd -r -s /usr/sbin/nologin fleet-agent
fi

# PM2 komutları çalıştırmak için pm2'yi fleet-agent kullanıcısı ile mi çağıracağız?
# Yaygın kullanım: pm2 root altında. Agent root değil — pm2'nin home dir'i hangi user'daysa
# o user altında çalıştır. Varsayılan: root pm2 → agent'i root altında bırak ama syscall'lar kısıtlı.
# Güvenli varsayılan: agent root altında, ama systemd ile syscall filter uygulanır.

chown -R root:root "$INSTALL_DIR"
chmod 750 "$INSTALL_DIR"
chmod 640 "$INSTALL_DIR/agent.js" "$INSTALL_DIR/package.json"

# ---------- env dosyası (token burada saklanır) ----------
ENV_FILE="$INSTALL_DIR/.env"
cat > "$ENV_FILE" <<EOF
PANEL_URL=$PANEL_URL
AGENT_TOKEN=$AGENT_TOKEN
${HOSTNAME_ARG:+AGENT_HOSTNAME=$HOSTNAME_ARG}
EOF
chmod 600 "$ENV_FILE"
chown root:root "$ENV_FILE"

# ---------- systemd service ----------
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
echo "==> systemd service yazılıyor: $SERVICE_PATH"
cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=Fleet Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/env node $INSTALL_DIR/agent.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Güvenlik hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictRealtime=true
SystemCallArchitectures=native
ReadWritePaths=/tmp

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
sleep 2

# ---------- sonuç ----------
echo
if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "✅ Fleet Agent çalışıyor"
  echo "   Log izleme : journalctl -u $SERVICE_NAME -f"
  echo "   Durum      : systemctl status $SERVICE_NAME"
  echo "   Durdur     : systemctl stop $SERVICE_NAME"
  echo "   Kaldır     : systemctl disable --now $SERVICE_NAME && rm -rf $INSTALL_DIR $SERVICE_PATH"
else
  echo "❌ Servis başlamadı. Log:"
  journalctl -u "$SERVICE_NAME" -n 30 --no-pager
  exit 1
fi
