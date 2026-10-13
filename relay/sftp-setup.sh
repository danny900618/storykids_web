#!/bin/bash
# =============================================================================
# 台新銷帳檔 sFTP 收檔：在轉發主機（Lightsail）上執行一次
#
#   台新 ──sFTP（port 2222，帳號 taishin，路徑 /upload）──→ 本主機
#   本主機每分鐘把收到的檔案 POST 到 Worker /api/taishin/file（帶密鑰），成功後移到 /var/lib/taishin/processed
#
# 用法（瀏覽器 SSH）：見 relay/README.md「台新銷帳檔 sFTP」。執行時會詢問：
#   1. taishin 帳號的密碼（＝申請書上填的登入密碼）
#   2. 轉交密鑰（＝Worker 的 TAISHIN_FILE_KEY）
# 可重複執行（例如換密碼、換密鑰、更新設定）。
# =============================================================================
set -euo pipefail

SFTP_USER="taishin"
SFTP_PORT="2222"
CHROOT="/srv/sftp/${SFTP_USER}"
WORK="/var/lib/taishin"
TARGET_URL_DEFAULT="https://storykids-web-production.c0981985611.workers.dev/api/taishin/file"
SSHD_MARK_BEGIN="# >>> storykids taishin sftp"
SSHD_MARK_END="# <<< storykids taishin sftp"

[[ $EUID -eq 0 ]] || { echo "請用 sudo 執行"; exit 1; }

echo "== 1/5 建立 sFTP 帳號與目錄"
# 帳號不能登入主機（沒有 shell），只能用 sFTP 上傳
id "$SFTP_USER" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir / --shell /usr/sbin/nologin "$SFTP_USER"
# chroot 目錄必須屬於 root 且其他人不可寫；台新只能寫入 upload
mkdir -p "$CHROOT/upload" "$WORK/processed"
chown root:root /srv/sftp "$CHROOT" && chmod 755 /srv/sftp "$CHROOT"
chown "$SFTP_USER:$SFTP_USER" "$CHROOT/upload" && chmod 750 "$CHROOT/upload"
chmod 700 "$WORK"

echo "== 2/5 設定 sFTP（port ${SFTP_PORT} 只給 ${SFTP_USER}；port 22 維持原本的管理用 SSH）"
cat > /etc/ssh/sshd_config.d/10-storykids-ports.conf <<EOF
# 22：管理用（Lightsail 瀏覽器 SSH）；${SFTP_PORT}：台新 sFTP
Port 22
Port ${SFTP_PORT}
EOF
# Match 區塊放在 sshd_config 最後面（放在 sshd_config.d 會影響後面的全域設定）
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-storykids
sed -i "/^${SSHD_MARK_BEGIN}$/,/^${SSHD_MARK_END}$/d" /etc/ssh/sshd_config
cat >> /etc/ssh/sshd_config <<EOF
${SSHD_MARK_BEGIN}
# 台新：只能在 port ${SFTP_PORT} 用密碼登入 sFTP，被限制在 ${CHROOT}，不能執行指令或轉送連線
Match User ${SFTP_USER} LocalPort ${SFTP_PORT}
	ForceCommand internal-sftp -l INFO
	ChrootDirectory ${CHROOT}
	PasswordAuthentication yes
	KbdInteractiveAuthentication no
	PubkeyAuthentication no
	AllowTcpForwarding no
	AllowAgentForwarding no
	AllowStreamLocalForwarding no
	PermitTunnel no
	PermitTTY no
	X11Forwarding no
# 其他帳號不能從 port ${SFTP_PORT} 登入
Match LocalPort ${SFTP_PORT} User *,!${SFTP_USER}
	PasswordAuthentication no
	PubkeyAuthentication no
	KbdInteractiveAuthentication no
${SSHD_MARK_END}
EOF
if ! sshd -t; then
  echo "❌ SSH 設定檢查失敗，已還原，未做任何變更"
  cp /etc/ssh/sshd_config.bak-storykids /etc/ssh/sshd_config
  rm -f /etc/ssh/sshd_config.d/10-storykids-ports.conf
  exit 1
fi
# Ubuntu 24.04 由 ssh.socket 監聽連接埠，改連接埠要重新產生 socket 設定
systemctl daemon-reload
if systemctl is-enabled ssh.socket >/dev/null 2>&1; then systemctl restart ssh.socket; fi
systemctl restart ssh

echo "== 3/5 設定 ${SFTP_USER} 的密碼（申請書上填的登入密碼）"
read -r -p "要設定或更換 ${SFTP_USER} 的密碼嗎？（第一次安裝請輸入 y）[y/N] " ans </dev/tty
if [[ "$ans" =~ ^[Yy]$ ]]; then passwd "$SFTP_USER" </dev/tty; fi

echo "== 4/5 設定轉交到 Worker"
read -r -p "Worker 收檔網址（直接按 Enter 使用 ${TARGET_URL_DEFAULT}）：" target </dev/tty
target="${target:-$TARGET_URL_DEFAULT}"
if [[ ! -f /etc/taishin-forward.headers ]] || { read -r -p "要設定或更換轉交密鑰嗎？[y/N] " ans </dev/tty; [[ "$ans" =~ ^[Yy]$ ]]; }; then
  read -r -s -p "轉交密鑰（與 Worker 的 TAISHIN_FILE_KEY 相同，輸入時不會顯示）：" key </dev/tty; echo
  [[ ${#key} -ge 32 ]] || { echo "❌ 密鑰太短（至少 32 字元）"; exit 1; }
  install -m 600 -o root -g root /dev/null /etc/taishin-forward.headers
  printf 'X-Relay-Key: %s\n' "$key" > /etc/taishin-forward.headers
fi
install -m 600 -o root -g root /dev/null /etc/taishin-forward.env
printf 'TARGET_URL="%s"\n' "$target" > /etc/taishin-forward.env

# 轉交程式：每分鐘執行，處理上傳完成（60 秒內沒有再變動）的檔案
cat > /usr/local/bin/taishin-forward <<'SCRIPT'
#!/bin/bash
# 把台新上傳的銷帳檔轉交給 Worker；成功才移走，失敗留在原處下次重試
set -uo pipefail
source /etc/taishin-forward.env
IN="/srv/sftp/taishin/upload"
DONE="/var/lib/taishin/processed"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
shopt -s nullglob
for f in "$IN"/*; do
  [[ -f "$f" ]] || continue
  # 上傳中的檔案先跳過：最後修改未滿 60 秒
  (( $(date +%s) - $(stat -c %Y "$f") >= 60 )) || continue
  name="$(basename "$f")"
  code=$(curl -sS -o "$OUT" -w '%{http_code}' --max-time 60 -X POST "$TARGET_URL" \
    -H @/etc/taishin-forward.headers -H "X-Filename: ${name}" -H 'Content-Type: application/octet-stream' \
    --data-binary @"$f") || code="000"
  if [[ "$code" == "200" ]]; then
    dest="$DONE/$(date +%Y-%m)"
    mkdir -p "$dest"
    mv "$f" "$dest/$(date +%Y%m%d-%H%M%S)-${name}"
    echo "已轉交：${name}（$(head -c 200 "$OUT")）"
  else
    echo "轉交失敗：${name}，HTTP ${code}：$(head -c 200 "$OUT")" >&2
  fi
done
# 已轉交的檔案在主機上保留 90 天（Worker 資料庫有完整保存）
find "$DONE" -type f -mtime +90 -delete
SCRIPT
chmod 700 /usr/local/bin/taishin-forward

echo "== 5/5 設定每分鐘自動轉交"
cat > /etc/systemd/system/taishin-forward.service <<'EOF'
[Unit]
Description=Forward Taishin settlement files to Worker
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/taishin-forward
EOF
cat > /etc/systemd/system/taishin-forward.timer <<'EOF'
[Unit]
Description=Forward Taishin settlement files every minute

[Timer]
OnCalendar=*:*:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now taishin-forward.timer

echo
echo "✅ 完成"
echo "   sFTP：port ${SFTP_PORT}、帳號 ${SFTP_USER}、上傳路徑 /upload"
echo "   轉交：${target}"
echo "   ⚠️ 記得在 Lightsail 防火牆開放 TCP ${SFTP_PORT}，來源只允許台新的 IP"
echo "   查看轉交紀錄：sudo journalctl -u taishin-forward --since today"
