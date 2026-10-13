#!/bin/bash
# =============================================================================
# 三竹簡訊轉發主機：AWS Lightsail 啟動指令碼（Ubuntu 24.04 LTS）
#
# 用法：建立 Lightsail 主機時，展開「新增啟動指令碼（Add launch script）」，
#       先改好下面三個值，再把整份內容貼上。主機第一次開機會自動執行，約 3～5 分鐘完成。
# 安裝紀錄：/var/log/storykids-relay-setup.log
# 步驟說明：relay/README.md
#
# ⚠️ 填好密鑰的版本不要存進 repo、不要貼到聊天或信件裡。
# =============================================================================

# ---- 請填寫 ----
# 轉發主機的網址（DNS 要指向這台主機的固定 IP）；可填多個，以「逗號＋空格」分隔
# DNS 轉到 Cloudflare 前可加臨時網址 <IP 以 - 連接>.sslip.io（自動解析到該 IP），例如：
#   RELAY_HOST="sms-relay.storykids.com.tw, 52-194-121-120.sslip.io"
RELAY_HOST="sms-relay.storykids.com.tw"
# 密鑰：在自己電腦執行 `openssl rand -hex 32` 產生，Worker 的 SMS_RELAY_KEY 要設定成同一組
RELAY_KEY="請貼上密鑰"
# HTTPS 憑證相關通知的信箱
ACME_EMAIL="story698@gmail.com"
# ---------------

set -euo pipefail
exec > /var/log/storykids-relay-setup.log 2>&1
echo "開始安裝：$(date)"

if [[ "$RELAY_KEY" == "請貼上密鑰" || ${#RELAY_KEY} -lt 32 ]]; then
  echo "錯誤：RELAY_KEY 尚未填寫或太短（至少 32 字元）"
  exit 1
fi

timedatectl set-timezone Asia/Taipei
export DEBIAN_FRONTEND=noninteractive

# ---- 安裝 Caddy（官方套件庫）----
apt-get update
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg unattended-upgrades
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

# ---- 設定值（只有 root 與 caddy 可讀）----
install -m 640 -o root -g caddy /dev/null /etc/caddy/relay.env
# 值加引號：RELAY_HOST 可以填多個網址（以逗號分隔），systemd 與 bash 都能正確讀取
cat > /etc/caddy/relay.env <<EOF
RELAY_HOST="${RELAY_HOST}"
RELAY_KEY="${RELAY_KEY}"
ACME_EMAIL="${ACME_EMAIL}"
EOF

mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/relay.conf <<'EOF'
[Service]
EnvironmentFile=/etc/caddy/relay.env
EOF

# ---- Caddy 設定（與 repo 的 relay/Caddyfile 相同；修改時兩邊都要改，可用 npm run relay:check 檢查）----
cat > /etc/caddy/Caddyfile <<'CADDYFILE'
# 三竹簡訊轉發主機（AWS Lightsail）的 Caddy 設定
#
# 為什麼需要：三竹的簡訊 API 只接受白名單內的固定 IP，Cloudflare Worker 沒有固定 IP。
# Worker 把簡訊請求送到這台主機，這台主機用自己的固定 IP 轉給三竹。
#
# 安全設計：
# - 只接受帶正確密鑰（X-Relay-Key）的 POST /api/mtk/SmSend，其他一律回 404，不是公開代理
# - 只會轉發到三竹的簡訊 API（網址寫死在這裡）
# - 密鑰轉發前移除，不會送到三竹
# - 不記錄請求內容（內含三竹帳密與家長手機）
#
# 環境變數（/etc/caddy/relay.env，由 setup.sh 建立）：
#   RELAY_HOST  轉發主機的網址，例如 sms-relay.storykids.com.tw
#   RELAY_KEY   與 Worker 的 SMS_RELAY_KEY 相同的密鑰
#   ACME_EMAIL  HTTPS 憑證到期等通知的信箱

{
	email {$ACME_EMAIL}
	# 不開放 Caddy 的管理介面到網路上（預設只在本機，這裡明確關閉）
	admin off
}

{$RELAY_HOST} {
	@authorized {
		method POST
		path /api/mtk/SmSend
		header X-Relay-Key {$RELAY_KEY}
	}

	handle @authorized {
		request_header -X-Relay-Key
		reverse_proxy https://smsapi.mitake.com.tw {
			header_up Host smsapi.mitake.com.tw
			transport http {
				dial_timeout 10s
				response_header_timeout 20s
			}
		}
	}

	# 健康檢查（不需要密鑰，不會連到三竹）：確認主機與 HTTPS 正常
	handle /healthz {
		respond "ok" 200
	}

	handle {
		respond 404
	}
}
CADDYFILE

# 檢查設定格式
set -a; source /etc/caddy/relay.env; set +a
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy

# ---- 自動安全更新（含 Caddy），需要時凌晨 4 點自動重開機 ----
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52storykids-relay <<'EOF'
Unattended-Upgrade::Origins-Pattern {
	"site=dl.cloudsmith.io";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
systemctl enable --now unattended-upgrades

echo "安裝完成：$(date)"
echo "DNS 指向這台主機後，Caddy 會自動申請 HTTPS 憑證；可用 https://${RELAY_HOST}/healthz 確認"
