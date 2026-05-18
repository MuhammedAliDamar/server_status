#!/usr/bin/env bash
# fleet-panel installer (PM2 + PostgreSQL)
#
# Yeni VPS'te, root olarak:
#   curl -fsSL https://raw.githubusercontent.com/MuhammedAliDamar/server_status/main/install-panel.sh | sudo bash
#
# Argüman opsiyonel (vermezsen random üretir):
#   sudo bash install-panel.sh --db-name x --db-user y --db-pass z --admin-pass abc
#
# Otomatik:
#   - Node.js 20 + git + build tools
#   - PostgreSQL 16 (Debian/Ubuntu) → DB + user + password (random ya da arg)
#   - Repo'yu /opt/fleet-panel'e klonlar
#   - .env (DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET, AGENT_REGISTRATION_SECRET — hepsi random)
#   - npm install + prisma migrate deploy + next build
#   - PM2 ile fleet-panel-web (:3000) + fleet-panel-ws (:4000)
#   - pm2 startup + save → boot'ta auto start
#   - Sonuçta URL, password, REGISTRATION_SECRET yazdırır

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/fleet-panel}"
REPO="https://github.com/MuhammedAliDamar/server_status.git"
PANEL_PORT="${PANEL_PORT:-3000}"
WS_PORT="${WS_PORT:-4000}"

# Argümanlar (opsiyonel, vermezsen random)
DB_NAME=""
DB_USER=""
DB_PASS=""
ADMIN_PASS=""
SESSION_SECRET=""
REGISTRATION_SECRET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-name) DB_NAME="$2"; shift 2 ;;
    --db-user) DB_USER="$2"; shift 2 ;;
    --db-pass) DB_PASS="$2"; shift 2 ;;
    --admin-pass) ADMIN_PASS="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --port) PANEL_PORT="$2"; shift 2 ;;
    --ws-port) WS_PORT="$2"; shift 2 ;;
    --help|-h) sed -n '1,18p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Random üret (verilmemişse)
rand() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | cut -c1-"$1"; }
rand_hex() { head -c 32 /dev/urandom | xxd -p -c 64 | head -c "$1"; }

DB_NAME="${DB_NAME:-fleet_panel}"
DB_USER="${DB_USER:-fleet_panel}"
DB_PASS="${DB_PASS:-$(rand 32)}"
ADMIN_PASS="${ADMIN_PASS:-$(rand 28)}"
SESSION_SECRET="${SESSION_SECRET:-$(rand_hex 64)}"
REGISTRATION_SECRET="${REGISTRATION_SECRET:-flt_reg_$(rand 32)}"

# ---------- root kontrolü ----------
if [[ $EUID -ne 0 ]]; then
  echo "[!] Root olarak çalıştır (sudo)" >&2
  exit 1
fi

echo "==> Fleet Panel kurulumu (PostgreSQL + PM2)"
echo "    Dir       : $INSTALL_DIR"
echo "    Panel port: $PANEL_PORT  WS port: $WS_PORT"
echo "    DB        : $DB_NAME (user: $DB_USER)"
echo

# ---------- sistem paketleri ----------
echo "==> Sistem paketleri"
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates build-essential xxd
  # postgresql
  if ! command -v psql >/dev/null 2>&1; then
    apt-get install -y -qq postgresql postgresql-contrib
    systemctl enable --now postgresql
  fi
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q git curl ca-certificates gcc gcc-c++ make vim-common
  if ! command -v psql >/dev/null 2>&1; then
    dnf install -y -q postgresql-server postgresql-contrib
    postgresql-setup --initdb 2>/dev/null || true
    systemctl enable --now postgresql
  fi
elif command -v yum >/dev/null 2>&1; then
  yum install -y -q git curl ca-certificates gcc gcc-c++ make
  if ! command -v psql >/dev/null 2>&1; then
    yum install -y -q postgresql-server postgresql-contrib
    postgresql-setup initdb 2>/dev/null || true
    systemctl enable --now postgresql
  fi
else
  echo "[!] apt/dnf/yum bulunamadı" >&2
  exit 1
fi

# ---------- Node.js 20 ----------
NODE_OK=false
if command -v node >/dev/null 2>&1; then
  NV=$(node -p "process.versions.node.split('.')[0]")
  [[ "$NV" -ge 18 ]] && NODE_OK=true
fi
if ! $NODE_OK; then
  echo "==> Node.js 20 kuruluyor"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    (command -v dnf >/dev/null && dnf install -y nodejs) || yum install -y nodejs
  fi
fi

# ---------- PM2 ----------
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> PM2 kuruluyor"
  npm install -g pm2 --no-audit --no-fund
fi

# ---------- PostgreSQL: DB + user ----------
echo "==> PostgreSQL: DB ve user oluşturuluyor"
# 'postgres' OS user'ı üzerinden psql çağrısı (peer auth)
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"" | grep -q 1 \
  || su - postgres -c "psql -c \"CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS';\""
su - postgres -c "psql -c \"ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASS';\"" >/dev/null

su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" | grep -q 1 \
  || su - postgres -c "psql -c \"CREATE DATABASE $DB_NAME OWNER $DB_USER;\""

su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;\"" >/dev/null
# Schema (public) yetkisi — pg 15+ default'u kısıtlı
su - postgres -c "psql -d $DB_NAME -c \"GRANT ALL ON SCHEMA public TO $DB_USER;\"" >/dev/null

DB_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?schema=public"

# ---------- Repo ----------
echo "==> Repo klonlanıyor → $INSTALL_DIR"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  cd "$INSTALL_DIR" && git pull --ff-only
else
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 "$REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR/panel"

# ---------- .env ----------
ENV_FILE="$INSTALL_DIR/panel/.env"
cat > "$ENV_FILE" <<EOF
DATABASE_URL="$DB_URL"
PANEL_PORT=$PANEL_PORT
WS_PORT=$WS_PORT
SESSION_SECRET="$SESSION_SECRET"
ADMIN_PASSWORD="$ADMIN_PASS"
AGENT_REGISTRATION_SECRET="$REGISTRATION_SECRET"
SLACK_WEBHOOK_URL=""
EOF
chmod 600 "$ENV_FILE"

# ---------- npm + prisma + build ----------
echo "==> npm install (birkaç dakika sürebilir)"
npm install --no-audit --no-fund

echo "==> Prisma migrate deploy"
npx prisma migrate deploy
npx prisma generate

echo "==> Next.js production build"
npm run build

# ---------- log dizini ----------
mkdir -p /var/log/fleet-panel
chmod 755 /var/log/fleet-panel

# ---------- PM2 başlat ----------
echo "==> PM2 başlatılıyor"
pm2 delete fleet-panel-web fleet-panel-ws 2>/dev/null || true
pm2 start "$INSTALL_DIR/panel/ecosystem.config.js"
pm2 save

# Boot'ta autostart
PM2_STARTUP=$(pm2 startup systemd -u root --hp /root 2>&1 | grep "sudo env" || true)
if [[ -n "$PM2_STARTUP" ]]; then
  eval "$(echo "$PM2_STARTUP" | sed 's/^.*sudo //')"
  pm2 save
fi

# ---------- firewall ipuçları ----------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then
  ufw allow "$PANEL_PORT" >/dev/null 2>&1 || true
  ufw allow "$WS_PORT" >/dev/null 2>&1 || true
fi

# ---------- bilgi ----------
PUBLIC_IP=$(curl -fsS https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
sleep 2

cat <<EOF

╔════════════════════════════════════════════════════════════════╗
║  ✅ Fleet Panel kuruldu                                        ║
╚════════════════════════════════════════════════════════════════╝

  📍 URL              : http://$PUBLIC_IP:$PANEL_PORT
  🔑 Admin password   : $ADMIN_PASS
  🔐 Register secret  : $REGISTRATION_SECRET

  📦 Veritabanı
     DSN : $DB_URL
     user: $DB_USER  /  db: $DB_NAME

  📁 Dosyalar
     Repo : $INSTALL_DIR
     Env  : $ENV_FILE  (600 izin, sadece root okur)
     Log  : /var/log/fleet-panel/

  🛠  PM2 yönetimi
     pm2 status                        # durum
     pm2 logs fleet-panel-web --lines 50
     pm2 logs fleet-panel-ws --lines 50
     pm2 restart fleet-panel-web fleet-panel-ws

  🚀 Bir sunucuya agent kurmak (sıfır UI etkileşimi):
     curl -fsSL https://raw.githubusercontent.com/MuhammedAliDamar/server_status/main/install-agent.sh \\
       | sudo bash -s -- --panel http://$PUBLIC_IP:$PANEL_PORT --register $REGISTRATION_SECRET

  ⚠️  Production: panel'i HTTPS arkasına al (Caddy en kolayı).
  ⚠️  Şifreyi/secret'i güvenli yere kaydet — kayboldularsa $ENV_FILE'da.

EOF
