#!/bin/bash
# =============================================================================
# 用 AWS CLI 建立三竹簡訊轉發主機（Lightsail），等同 relay/README.md 第 4～6、11 步
#
# 用法：
#   relay/create-lightsail.sh --profile <補習班 AWS 帳號的 profile> [--region ap-northeast-1] [--alarm-email 信箱]
#
# 前置：
#   1. 已建立 relay/setup.local.sh 並填好密鑰（見 relay/README.md 第 3 步）
#   2. AWS CLI 已設定「補習班自己的 AWS 帳號」的 profile（不要用公司或其他客戶的帳號）
#
# 會建立（會開始計費，約 US$5／月）：
#   - Lightsail 主機 storykids-sms-relay（Ubuntu 24.04、最便宜含 IPv4 的方案、啟動時執行 setup.local.sh）
#   - 固定 IP storykids-sms-relay-ip 並綁到主機
#   - 防火牆：開 80、443；SSH 22 只允許 Lightsail 瀏覽器 SSH
#   - （有 --alarm-email 時）主機狀態檢查失敗的 Email 通知
# =============================================================================
set -euo pipefail

PROFILE=""
REGION="ap-northeast-1"
ALARM_EMAIL=""
NAME="storykids-sms-relay"
IP_NAME="storykids-sms-relay-ip"
USER_DATA="$(dirname "$0")/setup.local.sh"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --alarm-email) ALARM_EMAIL="$2"; shift 2 ;;
    *) echo "未知參數：$1"; exit 1 ;;
  esac
done

if [[ -z "$PROFILE" ]]; then
  echo "請用 --profile 指定補習班 AWS 帳號的 profile（為了避免誤用其他帳號，不使用預設 profile）"
  exit 1
fi
if [[ ! -f "$USER_DATA" ]]; then
  echo "找不到 $USER_DATA：請先 cp relay/setup.sh relay/setup.local.sh 並填好密鑰"
  exit 1
fi
if grep -q 'RELAY_KEY="請貼上密鑰"' "$USER_DATA"; then
  echo "$USER_DATA 的 RELAY_KEY 還沒填寫"
  exit 1
fi

aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

# ---- 確認帳號，避免建到錯誤的 AWS 帳號 ----
ACCOUNT=$(aws_ sts get-caller-identity --query Account --output text)
ALIAS=$(aws_ iam list-account-aliases --query 'AccountAliases[0]' --output text 2>/dev/null || echo "（無法取得）")
echo "AWS 帳號：$ACCOUNT（別名：$ALIAS）"
echo "地區：$REGION"
echo "將建立 Lightsail 主機 $NAME 與固定 IP $IP_NAME，開始計費（約 US\$5／月）"
read -r -p "確認這是「補習班」的 AWS 帳號並建立？輸入 yes 繼續：" ANSWER
[[ "$ANSWER" == "yes" ]] || { echo "已取消"; exit 1; }

# ---- 選擇映像檔與方案 ----
BLUEPRINT=$(aws_ lightsail get-blueprints \
  --query "blueprints[?isActive && starts_with(blueprintId, 'ubuntu_24_04')].blueprintId | [0]" --output text)
BUNDLE=$(aws_ lightsail get-bundles \
  --query "sort_by(bundles[?isActive && contains(supportedPlatforms, 'LINUX_UNIX') && (publicIpv4AddressCount == null || publicIpv4AddressCount > \`0\`)], &price)[0].bundleId" --output text)
PRICE=$(aws_ lightsail get-bundles --query "bundles[?bundleId=='$BUNDLE'].price | [0]" --output text)
echo "映像檔：$BLUEPRINT；方案：$BUNDLE（US\$$PRICE／月）"
[[ "$BLUEPRINT" != "None" && "$BUNDLE" != "None" ]] || { echo "找不到 Ubuntu 24.04 或可用方案"; exit 1; }

# ---- 建立主機 ----
aws_ lightsail create-instances \
  --instance-names "$NAME" \
  --availability-zone "${REGION}a" \
  --blueprint-id "$BLUEPRINT" \
  --bundle-id "$BUNDLE" \
  --user-data "file://$USER_DATA" \
  --tags key=project,value=storykids key=purpose,value=sms-relay >/dev/null
echo "主機建立中…"
for _ in $(seq 1 60); do
  STATE=$(aws_ lightsail get-instance-state --instance-name "$NAME" --query state.name --output text)
  [[ "$STATE" == "running" ]] && break
  sleep 5
done
echo "主機狀態：$STATE"

# ---- 固定 IP ----
aws_ lightsail allocate-static-ip --static-ip-name "$IP_NAME" >/dev/null
aws_ lightsail attach-static-ip --static-ip-name "$IP_NAME" --instance-name "$NAME" >/dev/null
STATIC_IP=$(aws_ lightsail get-static-ip --static-ip-name "$IP_NAME" --query staticIp.ipAddress --output text)

# ---- 防火牆：80、443 開放；SSH 只允許 Lightsail 瀏覽器 SSH ----
aws_ lightsail put-instance-public-ports --instance-name "$NAME" --port-infos '[
  {"fromPort":80,"toPort":80,"protocol":"tcp","cidrs":["0.0.0.0/0"],"ipv6Cidrs":["::/0"]},
  {"fromPort":443,"toPort":443,"protocol":"tcp","cidrs":["0.0.0.0/0"],"ipv6Cidrs":["::/0"]},
  {"fromPort":22,"toPort":22,"protocol":"tcp","cidrListAliases":["lightsail-connect"]}
]' >/dev/null

# ---- 當機通知（選填）----
if [[ -n "$ALARM_EMAIL" ]]; then
  aws_ lightsail create-contact-method --protocol Email --contact-endpoint "$ALARM_EMAIL" >/dev/null 2>&1 || true
  aws_ lightsail put-alarm --alarm-name "${NAME}-status-check" --monitored-resource-name "$NAME" \
    --metric-name StatusCheckFailed --comparison-operator GreaterThanOrEqualToThreshold \
    --threshold 1 --evaluation-periods 1 --contact-protocols Email --notification-enabled >/dev/null
  echo "已設定當機通知：$ALARM_EMAIL（請到信箱點確認信，通知才會生效）"
fi

cat <<EOF

✅ 建立完成
   主機：$NAME（$REGION）
   固定 IP：$STATIC_IP   ← 給三竹加入白名單；Cloudflare DNS 新增 A 記錄 sms-relay → 這個 IP（DNS only）

接著（relay/README.md 第 7～10 步）：
   1. 請三竹把 $STATIC_IP 加入白名單
   2. storykids.com.tw 轉到 Cloudflare 後，新增 DNS：sms-relay → $STATIC_IP（DNS only）
   3. 約 3～5 分鐘後安裝完成；DNS 生效後打開 https://sms-relay.storykids.com.tw/healthz 應顯示 ok
   4. Worker：wrangler secret put SMS_RELAY_KEY、改 MITAKE_API_URL，後台發測試簡訊

⚠️ 固定 IP 在三竹白名單有效期間不要 Release；relay/setup.local.sh 含密鑰，不要 commit
EOF
