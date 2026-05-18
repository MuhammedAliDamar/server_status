#!/usr/bin/env bash
# fleet-panel installer
# Usage (yeni VPS'te, root olarak):
#   curl -fsSL https://raw.githubusercontent.com/MuhammedAliDamar/server_status/main/install-panel.sh | sudo bash
#
# Otomatik:
#   - Node.js 20 kurar
#   - Repo'yu /opt/fleet-panel'e klonlar, npm install + prisma migrate + build
#   - Random ADMIN_PASSWORD ve SESSION_SECRET üretir
#   - systemd units (panel + ws)
#   - Sonuç: URL + şifre yazdırır

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/fleet-panel}"
REPO="https://github.com/MuhammedAliDamar/server_status.git"
PANEL_PORT="${PANEL_PORT:-3000}"
WS_PORT="${WS_PORT:-4000}"

if [[ $EUID -ne 0 ]]; then
  echo "[!] Root olarak çalıştır (sudo)" >&2
  exit 1
fi

echo "==> Fleet Panel kurulumu başlıyor"
echo "    Hedef     : $INSTALL_DIR"
echo "    Panel port: $PANEL_PORT"
echo "    WS port   : $WS_PORT"
echo

# ---------- temel paketler ----------
echo "==> Sistem paketleri"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates build-essential
elif command -v yum >/dev/null 2>&1; then
  yum install -y -q git curl ca-certificates gcc gcc-c++ make
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache git curl ca-certificates build-base python3
else
  echo "[!] apt/yum/apk bulunamadı" >&2
  exit 1
fi

# ---------- Node.js 20 ----------
NODE_OK=false
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node -p "process.versions.node.split('.')[0]")
  if [[ "$NODE_VER" -ge 18 ]]; then NODE_OK=true; fi
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
  fi
fi

# ---------- repo ----------
echo "==> Repo klonlanıyor"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  cd "$INSTALL_DIR" && git pull --ff-only
else
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 "$REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR/panel"

# ---------- env üret (random) ----------
ENV_FILE="$INSTALL_DIR/panel/.env"
if [[ -f "$ENV_FILE" ]]; then
  echo "==> Mevcut .env korunuyor"
  ADMIN_PASS=$(grep '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d'"' -f2)
else
  ADMIN_PASS=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | cut -c1-28)
  SESSION_SECRET=$(head -c 32 /dev/urandom | xxd -p -c 64)
  cat > "$ENV_FILE" <<EOF
DATABASE_URL="file:./dev.db"
PANEL_PORT=$PANEL_PORT
WS_PORT=$WS_PORT
SESSION_SECRET="$SESSION_SECRET"
ADMIN_PASSWORD="$ADMIN_PASS"
SLACK_WEBHOOK_URL=""
EOF
  chmod 600 "$ENV_FILE"
fi

# ---------- npm install + prisma + build ----------
echo "==> npm install (bu birkaç dakika sürebilir)"
npm install --no-audit --no-fund

echo "==> Prisma migrate"
npx prisma migrate deploy
npx prisma generate

echo "==> Next.js production build"
npm run build

# ---------- systemd ----------
echo "==> systemd units"

cat > /etc/systemd/system/fleet-panel-web.service <<EOF
[Unit]
Description=Fleet Panel (Next.js)
After=network-online.target fleet-panel-ws.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/panel
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/env npm run start -- -p $PANEL_PORT
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$INSTALL_DIR/panel

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/fleet-panel-ws.service <<EOF
[Unit]
Description=Fleet Panel WS Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/panel
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/env npx tsx server/ws-server.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$INSTALL_DIR/panel

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now fleet-panel-ws fleet-panel-web
sleep 3

# ---------- firewall ipucu ----------
if command -v ufw >/dev/null 2>&1; then
  echo "==> ufw mevcut — portları aç (gerekirse):"
  echo "   ufw allow $PANEL_PORT && ufw allow $WS_PORT"
fi

# ---------- sonuç ----------
PUBLIC_IP=$(curl -fsS https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo "✅ Fleet Panel kuruldu"
echo
echo "   URL       : http://$PUBLIC_IP:$PANEL_PORT"
echo "   Password  : $ADMIN_PASS"
echo "   WS endpoint (agent için): ws://$PUBLIC_IP:$WS_PORT"
echo
echo "   Log izleme: journalctl -u fleet-panel-web -f"
echo "                journalctl -u fleet-panel-ws -f"
echo "   Restart   : systemctl restart fleet-panel-web fleet-panel-ws"
echo
echo "   ⚠️  Production'da panel'i HTTPS arkasına al (caddy/nginx)."
echo "   ⚠️  Şifreyi güvenli bir yere kaydet — .env'de saklanıyor: $ENV_FILE"
