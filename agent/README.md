# fleet-agent

Hafif Node.js agent. Her sunucuda çalışır, panele metric/log push eder, komut yürütür.

## Kurulum

```bash
# 1. Dosyaları kopyala
scp -r agent/ user@server:/opt/fleet-agent/

# 2. SSH ile bağlan
ssh user@server
cd /opt/fleet-agent
npm install

# 3. Env ayarla
export PANEL_URL="ws://your-panel-host:4000"
export AGENT_TOKEN="<panel'den-aldığın-token>"

# 4. Çalıştır
node agent.js
```

## systemd (kalıcı)

```ini
# /etc/systemd/system/fleet-agent.service
[Unit]
Description=Fleet Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/fleet-agent
ExecStart=/usr/bin/node agent.js
Restart=always
RestartSec=5
Environment=PANEL_URL=ws://panel.example.com:4000
Environment=AGENT_TOKEN=xxx

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now fleet-agent
sudo journalctl -u fleet-agent -f
```

## Güvenlik

- Agent SADECE whitelist'lenmiş PM2 komutlarını (`start`/`stop`/`restart`) çalıştırır
- Keyfi shell komutu yok
- Bağlantı outbound (agent → panel) — sunucuda yeni port açmaz
- Token panel DB'de hash'lenmiş tutulur, plain text sadece kurulumda kopyalanır
