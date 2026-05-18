#!/usr/bin/env bash
# Fleet Panel için nginx + Let's Encrypt kurulumu
#
# Kullanım (panel kurulu sunucuda, root olarak):
#   curl -fsSL https://raw.githubusercontent.com/MuhammedAliDamar/server_status/main/setup-nginx.sh | \
#     sudo bash -s -- --domain monitor.kisisel.ai --email senin@mail.com
#
# Yapacakları:
#   - nginx + certbot kurar
#   - <domain> için ters proxy config'i yazar:
#       https://<domain>/        → http://localhost:9852  (panel web)
#       wss://<domain>/agent     → ws://localhost:2589/agent  (agent WS)
#   - Let's Encrypt cert alır, otomatik yenileme cron'unu kurar
#   - panel/.env'ye PANEL_EXTERNAL_WS_URL ekler
#   - PM2 ile panel'i restart eder

set -euo pipefail

DOMAIN=""
EMAIL=""
INSTALL_DIR="${INSTALL_DIR:-/opt/fleet-panel}"
PANEL_PORT="${PANEL_PORT:-9852}"
WS_PORT="${WS_PORT:-2589}"
NO_TLS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain|-d) DOMAIN="$2"; shift 2 ;;
    --email|-e) EMAIL="$2"; shift 2 ;;
    --no-tls) NO_TLS=true; shift ;;
    --panel-port) PANEL_PORT="$2"; shift 2 ;;
    --ws-port) WS_PORT="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --help|-h) sed -n '1,18p' "$0"; exit 0 ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "[!] Root olarak çalıştır (sudo)" >&2; exit 1
fi
if [[ -z "$DOMAIN" ]]; then
  echo "[!] --domain gerekli (örn: monitor.kisisel.ai)" >&2; exit 1
fi
if ! $NO_TLS && [[ -z "$EMAIL" ]]; then
  read -rp "Let's Encrypt için email: " EMAIL
fi

if [[ ! -d "$INSTALL_DIR/panel" ]]; then
  echo "[!] $INSTALL_DIR/panel bulunamadı. Önce install-panel.sh çalıştır." >&2
  exit 1
fi

echo "==> Nginx + TLS kurulumu"
echo "    Domain: $DOMAIN"
echo "    Panel : localhost:$PANEL_PORT"
echo "    WS    : localhost:$WS_PORT"
echo "    TLS   : $($NO_TLS && echo 'kapalı' || echo 'Let'\''s Encrypt')"
echo

# ---------- DNS kontrolü (uyarı, blocker değil) ----------
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
PUBLIC_IP=$(curl -fsS https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
if [[ -n "$RESOLVED" && "$RESOLVED" != "$PUBLIC_IP" ]]; then
  echo "[uyarı] DNS: $DOMAIN → $RESOLVED, sunucu IP: $PUBLIC_IP"
  echo "         A kaydı doğru sunucuyu göstermiyor olabilir. Devam ediliyor..."
elif [[ -z "$RESOLVED" ]]; then
  echo "[uyarı] DNS resolve etmedi. A kaydını $PUBLIC_IP'ye ayarladığından emin ol."
fi

# ---------- nginx + certbot ----------
echo "==> nginx kurulumu"
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq nginx
  if ! $NO_TLS; then
    apt-get install -y -qq certbot python3-certbot-nginx
  fi
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q nginx
  ! $NO_TLS && dnf install -y -q certbot python3-certbot-nginx
elif command -v yum >/dev/null 2>&1; then
  yum install -y -q nginx
  ! $NO_TLS && yum install -y -q certbot python3-certbot-nginx
else
  echo "[!] paket yöneticisi bulunamadı" >&2; exit 1
fi

systemctl enable --now nginx

# ---------- nginx config (HTTP only — certbot upgrade edecek) ----------
CONF_PATH="/etc/nginx/sites-available/${DOMAIN}.conf"
if [[ ! -d /etc/nginx/sites-available ]]; then
  # CentOS/RHEL: conf.d kullan
  CONF_PATH="/etc/nginx/conf.d/${DOMAIN}.conf"
fi

echo "==> nginx config: $CONF_PATH"
cat > "$CONF_PATH" <<EOF
# Fleet Panel — $DOMAIN
upstream fleet_panel_web { server 127.0.0.1:$PANEL_PORT; }
upstream fleet_panel_ws  { server 127.0.0.1:$WS_PORT; }

# WebSocket upgrade map
map \$http_upgrade \$connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 80;
  listen [::]:80;
  server_name $DOMAIN;

  # Cloudflare/upstream real IP
  real_ip_header X-Forwarded-For;
  set_real_ip_from 0.0.0.0/0;

  # Body size — log payload'ları için biraz cömert
  client_max_body_size 5m;

  # Agent WebSocket endpoint
  location /agent {
    proxy_pass http://fleet_panel_ws/agent;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$connection_upgrade;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
  }

  # Panel web (UI + API)
  location / {
    proxy_pass http://fleet_panel_web;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$connection_upgrade;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 90s;
    proxy_buffering off;
  }

  # SSE (server-sent events) için buffering off
  location ~ ^/api/servers/[^/]+/logs/ {
    proxy_pass http://fleet_panel_web;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding off;
    proxy_read_timeout 86400s;
  }
}
EOF

# Debian-style sites-enabled symlink
if [[ -d /etc/nginx/sites-enabled ]]; then
  ln -sf "$CONF_PATH" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
  # default site'i devre dışı bırak (varsa)
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl reload nginx

# ---------- TLS ----------
WS_PROTO="ws"
HTTP_PROTO="http"
if ! $NO_TLS; then
  echo "==> Let's Encrypt cert alınıyor"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
  # certbot otomatik renewal cron'u kurar (systemd timer veya cron.d)
  WS_PROTO="wss"
  HTTP_PROTO="https"
fi

# ---------- panel/.env'ye external ws url ekle ----------
ENV_FILE="$INSTALL_DIR/panel/.env"
EXTERNAL_WS_URL="${WS_PROTO}://${DOMAIN}/agent"
if grep -q "^PANEL_EXTERNAL_WS_URL=" "$ENV_FILE"; then
  sed -i "s|^PANEL_EXTERNAL_WS_URL=.*|PANEL_EXTERNAL_WS_URL=$EXTERNAL_WS_URL|" "$ENV_FILE"
else
  echo "PANEL_EXTERNAL_WS_URL=$EXTERNAL_WS_URL" >> "$ENV_FILE"
fi

# ---------- panel restart (yeni env'i alsın) ----------
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart fleet-panel-web fleet-panel-ws 2>/dev/null || true
fi

# ---------- bilgi ----------
cat <<EOF

╔════════════════════════════════════════════════════════════════╗
║  ✅ Nginx + TLS hazır                                          ║
╚════════════════════════════════════════════════════════════════╝

  🌐 Panel URL    : ${HTTP_PROTO}://${DOMAIN}
  📡 Agent WS URL : ${WS_PROTO}://${DOMAIN}/agent

  🔑 Login        : grep ADMIN_PASSWORD $ENV_FILE
  🔐 Register key : grep AGENT_REGISTRATION_SECRET $ENV_FILE

  🚀 Yeni agent kurmak (artık 443 yeterli, başka port açmazsın):
     curl -fsSL https://raw.githubusercontent.com/MuhammedAliDamar/server_status/main/install-agent.sh | \\
       sudo bash -s -- --panel ${HTTP_PROTO}://${DOMAIN} --register \$(grep AGENT_REGISTRATION_SECRET $ENV_FILE | cut -d'=' -f2 | tr -d '"')

  📝 Nginx config: $CONF_PATH
     nginx -t            # config doğrula
     systemctl reload nginx
     tail -f /var/log/nginx/error.log

EOF
