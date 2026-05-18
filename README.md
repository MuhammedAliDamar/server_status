# Fleet Panel

Çoklu sunucu izleme + kontrol paneli. Sunuculara hafif bir Node.js agent kurarsın; merkezi panelden tüm sunucuların CPU/RAM/disk durumunu canlı görür, PM2 process'lerini start/stop/restart edersin. Slack alert desteklidir.

## Mimari

```
[panel sunucusu]                          [hedef sunucular]
Next.js (UI + API)      :3000                    
  └─ HTTP ────►  ws-server     :4000  ◄── WS ──  agent.js
                  ├─ live state (in-memory)        ├─ os metrics
                  ├─ alert engine (Slack)          ├─ pm2 jlist
                  └─ SQLite (servers, audit)       ├─ git log
                                                   └─ pm2 cmds (whitelist)
```

- **Panel** (`panel/`): Next.js 16 + Prisma + SQLite. UI ve REST API.
- **WS sunucusu** (`panel/server/ws-server.ts`): Panel'le birlikte çalışır. Agent'ları kabul eder, canlı state tutar.
- **Agent** (`agent/`): Her hedef sunucuya kurulur. Outbound WS ile panele bağlanır — sunucuda yeni port açmaz.

## Hızlı başlangıç (local)

```bash
# 1. Panel
cd panel
npm install
npx prisma migrate dev
npm run dev:all   # Next.js (:3000) + WS server (:4000)

# 2. Tarayıcıdan http://localhost:3000
#    - Login (varsayılan password: admin)
#    - "+ Add Server" → ad ver → token al

# 3. Aynı makinede test için agent çalıştır
cd ../agent
npm install
PANEL_URL="ws://localhost:4000" AGENT_TOKEN="<panel'den-aldığın>" node agent.js
```

Panel dashboard'da sunucu canlı görünür: CPU/RAM/Disk barları, PM2 process listesi, log viewer, start/stop/restart butonları.

## Agent kurulumu (tek satır)

Hedef sunucuya SSH ile gir, panel'den aldığın token ile şu satırı çalıştır:

```bash
curl -fsSL https://raw.githubusercontent.com/MuhammedAliDamar/server_status/main/install-agent.sh | \
  sudo bash -s -- --panel ws://<panel-ip-veya-domain>:4000 --token flt_xxx
```

Otomatik olarak:
- Node.js 20 yüklenir (yoksa)
- `/opt/fleet-agent` altına agent kopyalanır, npm install yapılır
- `.env` 600 izniyle oluşturulur (token sadece root okur)
- systemd service kurulur, hardened güvenlik flag'leriyle (`NoNewPrivileges`, `ProtectSystem=strict`, syscall filter)
- Servis başlatılır, panel'de sunucu yeşil yanar

### Manuel kurulum (alternatif)

Detaylar için `agent/README.md`.

## Sunucuya kurulum (production)

Panel için (yeni VPS):

```bash
cd panel
npm install
npx prisma migrate deploy
npm run build
# .env içinde: ADMIN_PASSWORD, SESSION_SECRET, SLACK_WEBHOOK_URL
pm2 start npm --name fleet-panel-web -- start
pm2 start "npm run ws" --name fleet-panel-ws
```

Agent için (her hedef sunucu): `agent/README.md` (systemd örneği var).

## Özellikler

- ✅ Çoklu sunucu, canlı CPU/RAM/disk/load metrikleri (2 sn'de bir refresh)
- ✅ PM2 process listesi: status, CPU, RAM, uptime, restart count, git branch
- ✅ Process kontrolü: start / stop / restart (whitelist'lenmiş, audit log'a yazılır)
- ✅ Canlı log viewer (SSE, pause/filter/clear)
- ✅ Slack alert: CPU/RAM/disk threshold aşımı, agent offline, process error/restart
- ✅ Sunucu yönetimi: ekle/sil, token üret, yeniden token üret
- ✅ Tek admin password ile login (cookie-based session)

## Güvenlik notları

**Agent tarafı:**
- Sadece whitelist'lenmiş PM2 komutları çalıştırılır (`start`/`stop`/`restart`). Keyfi shell komutu yok.
- Tüm exec çağrıları `execFile`/`spawn` ile `shell: false` — shell injection yok.
- pm2Id kesinlikle integer olmak zorunda, range check var, parametrize edilmeden execFile arg olarak verilir.
- WS mesaj boyutu 8KB cap, bilinmeyen mesaj türleri reddedilir, 10+ invalid mesajda bağlantı koparılır.
- Dakikada max 30 komut (rate limit). Eş zamanlı max 8 log stream.
- Token formatı (`flt_<alnum>{30,80}`) önceden doğrulanır — bcrypt DoS önlenir.
- Plain `ws://` (non-localhost) kullanılırsa uyarı verir.
- systemd service `NoNewPrivileges`, `ProtectSystem=strict`, `MemoryDenyWriteExecute`, syscall filter ile hardened.

**Panel tarafı:**
- Token'lar DB'de bcrypt ile hash'lenmiş tutulur, plain text sadece kurulumda gösterilir.
- WS sunucusu (`:4000`) internal HTTP endpoint'leri `x-internal-secret` header'ı ile filtreler.
- Audit log: tüm sunucu CRUD ve komut yürütmeleri DB'de kayıt altında.
- Cookie session HMAC-imzalı, 7 gün TTL.

**Üretimde mutlaka:**
- `ADMIN_PASSWORD` ve `SESSION_SECRET`'i değiştir (default'lar sadece dev).
- Panel'i HTTPS arkasına al (caddy/nginx reverse proxy).
- Agent bağlantısını `wss://` üzerinden yap.
- Panel'in `:4000` portunu sadece agent IP'lerine aç (firewall).

## .env

```
DATABASE_URL="file:./dev.db"
PANEL_PORT=3000
WS_PORT=4000
SESSION_SECRET="..."         # production'da random uzun string
ADMIN_PASSWORD="..."          # login için
SLACK_WEBHOOK_URL=""          # opsiyonel — alarm gönderir
```

## Yol haritası

- [ ] Geçmiş metric grafikleri (son 24h CPU/RAM trend) — `MetricSnapshot` tablosuna düzenli yazma
- [ ] Multi-user + role-based access
- [ ] 2FA
- [ ] Alert kurallarını UI'dan konfigüre etme (şu an kod içinde sabit)
- [ ] Telegram / email alert kanalları
