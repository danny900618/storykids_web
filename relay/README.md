# 轉發主機（AWS Lightsail）：三竹簡訊、台新銷帳檔

三竹的簡訊 API 只接受**白名單內的固定 IP**，Cloudflare Worker 沒有固定 IP（實測連線會被直接丟掉）。
所以租一台有固定 IP 的小主機，專門把 Worker 的簡訊請求轉給三竹：

```
Worker ──HTTPS + 密鑰──→ 轉發主機 sms-relay.storykids.com.tw（固定 IP）──→ 三竹 smsapi.mitake.com.tw
```

| 檔案 | 用途 |
|---|---|
| [Caddyfile](Caddyfile) | 轉發設定：只接受帶密鑰的 `POST /api/mtk/SmSend`、只轉給三竹、自動 HTTPS、不記錄內容 |
| [setup.sh](setup.sh) | Lightsail 啟動指令碼：開機自動安裝 Caddy、寫入設定、開啟自動安全更新 |
| [sftp-setup.sh](sftp-setup.sh) | 台新銷帳檔 sFTP 收檔（port 2222）＋每分鐘轉交 Worker（見文末） |
| [create-lightsail.sh](create-lightsail.sh) | 用 AWS CLI 一次建立主機、固定 IP、防火牆、當機通知（等同網頁操作第 4～6、11 步） |

修改轉發設定時，`Caddyfile` 與 `setup.sh` 內嵌的版本要一起改，`npm run relay:check` 會檢查兩邊是否一致。

**主機選擇**（依三竹對 IP 的要求）：

| 三竹的要求 | 主機 | 費用 | 安裝步驟 |
|---|---|---|---|
| **台灣固定 IP**（2026-10-13 三竹回覆） | **AWS EC2 台北（ap-east-2）** | 約 US$8／月（估算：主機＋公有 IPv4 US$3.65＋硬碟） | 見下方「[EC2 台北](#ec2-台北三竹要求台灣-ip-時)」 |
| 不限國家的固定 IP | AWS Lightsail 東京 | 約 US$5／月（含 IPv4，固定 IP 綁在主機上免費） | 見下方「安裝步驟」 |
**主機裡沒有任何資料**，壞掉直接重建即可，不需要備份。

---

## 開始前：先問三竹

- 白名單的固定 IP **可以是國外機房嗎**（Lightsail 沒有台灣機房，最近是東京）？
- 若三竹**一定要台灣 IP**：改用 AWS EC2 台北區（ap-east-2），`setup.sh` 一樣可用，費用約 US$8／月

---

## 安裝步驟（一次性，約 30 分鐘）

### 1. AWS 帳號

1. 用補習班的 Email 註冊 AWS，綁補習班的信用卡
2. **根帳號開啟 MFA（雙重驗證）**：右上角帳號 → Security credentials → Assign MFA device
3. **預算通知**：搜尋「Budgets」→ Create budget → 月預算 US$15，超過 80% 寄信通知

### 2. 產生密鑰

在自己電腦執行，把結果存進密碼管理工具（之後 Worker 也要設定同一組）：

```sh
openssl rand -hex 32 #036e3628fc79f71fb821c15d3f85ebebf482a77e398e5079d1827f771b00bc33
```

### 3. 準備啟動指令碼

```sh
cp relay/setup.sh relay/setup.local.sh   # setup.local.sh 已列入 .gitignore，不會被 commit
```

打開 `relay/setup.local.sh`，修改最上面三個值：

- `RELAY_HOST`：`sms-relay.storykids.com.tw`
- `RELAY_KEY`：第 2 步的密鑰
- `ACME_EMAIL`：補習班信箱

⚠️ 填好密鑰的檔案**不要 commit、不要貼到聊天或信件**。

### 4～6、11 步也可以用指令一次完成（需要 AWS CLI 設定好補習班帳號的 profile）

```sh
relay/create-lightsail.sh --profile storykids --alarm-email c0981985611@gmail.com
```

指令碼會先顯示 AWS 帳號、要求輸入 `yes` 確認，避免建到別的帳號。完成後會印出固定 IP，接著做第 7 步。
不用指令的話，照下面第 4～6、11 步在網頁上操作：

### 4. 建立主機

Lightsail 主控台（https://lightsail.aws.amazon.com）→ **Create instance**：

| 設定 | 選擇 |
|---|---|
| Region | **Tokyo（ap-northeast-1）**（或三竹要求的地區） |
| Platform | Linux/Unix |
| Blueprint | **OS Only → Ubuntu 24.04 LTS** |
| Launch script | 展開「**Add launch script**」→ 貼上 `setup.local.sh` 的完整內容 |
| Plan | 最便宜、**含 IPv4** 的方案 |
| Name | `storykids-sms-relay` |

按 **Create instance**，等狀態變成 Running，再等 3～5 分鐘讓安裝跑完。

#### 啟動指令碼沒有執行時（手動安裝）

確認方式：瀏覽器 SSH 執行 `sudo tail -5 /var/log/storykids-relay-setup.log`，出現 No such file 代表沒執行（建立時漏貼）。
瀏覽器 SSH 貼上中文會變亂碼，所以用 base64 傳送：

```sh
# 自己電腦（-b 76 切成短行，避免一整行太長被終端機截斷）
base64 -b 76 -i relay/setup.local.sh | pbcopy
shasum -a 256 relay/setup.local.sh          # 記下檢查碼

# 瀏覽器 SSH：輸入下面這行 → 貼上 → Enter → Ctrl+D
base64 -d | sudo tee /root/setup.sh > /dev/null
sudo sha256sum /root/setup.sh               # 要與上面的檢查碼相同
sudo bash /root/setup.sh                    # 約 2～4 分鐘，畫面沒有輸出
systemctl is-active caddy                   # 顯示 active 即成功
sudo rm /root/setup.sh                      # 刪除含密鑰的暫存檔
```

### 5. 固定 IP

Lightsail → **Networking** → **Create static IP** → 綁定主機選 `storykids-sms-relay`，靜態 IP 名稱填 **`storykids-sms-relay-ip`**（不能跟主機同名）→ 建立。記下這個 IP。
一台主機只要一個靜態 IP；建立前先看 Networking 是否已有沒綁定的靜態 IP，有的話直接 Attach，不要重複建立。

⚠️ 固定 IP **要一直綁在主機上**（免費）；沒綁主機時 AWS 會收費。
⚠️ 固定 IP 只要留在帳號裡就**只有我們能用**；一旦 **Release（釋放）**，IP 會回到 AWS 公用池、可能分配給別人。
**三竹白名單還有這個 IP 時，絕對不要釋放**；不用時先請三竹移除白名單，再釋放。

### 6. 防火牆

主機 → **Networking** 分頁 → IPv4 Firewall（IPv6 Firewall 也做一樣的設定）：

| 規則 | 設定 |
|---|---|
| HTTPS 443 | 保留（Worker 連進來） |
| HTTP 80 | **新增**（申請 HTTPS 憑證需要） |
| SSH 22 | 改為只允許 **Lightsail browser SSH**（勾選 Restrict to Lightsail browser SSH） |

### 7. 三竹白名單

把第 5 步的固定 IP 給三竹，請他們加入白名單。

### 7.5 DNS 轉過來之前先測試（臨時網址）

`52-194-121-120.sslip.io` 這種網址會自動解析到 52.194.121.120，不用設 DNS，Caddy 也能替它申請 HTTPS 憑證。
（公司網路若有 Fortinet 等防火牆，可能擋 sslip.io，只影響自己電腦，Cloudflare 不受影響）

1. 主機（瀏覽器 SSH）：讓 Caddy 同時接正式網址與臨時網址
   ```sh
   sudo sed -i 's|^RELAY_HOST=.*|RELAY_HOST="sms-relay.storykids.com.tw, 52-194-121-120.sslip.io"|' /etc/caddy/relay.env
   sudo systemctl restart caddy
   sleep 20; curl -s https://52-194-121-120.sslip.io/healthz; echo   # 顯示 ok 代表 HTTPS 憑證已申請成功
   ```
2. Worker 測試環境：`wrangler.jsonc` 最上層的 `MITAKE_API_URL` 已設為 `https://52-194-121-120.sslip.io/api/mtk/SmSend`，再設定密鑰：
   ```sh
   npx wrangler secret put SMS_RELAY_KEY      # 與 setup.local.sh 的 RELAY_KEY 相同
   ```
3. 測試環境報名管理後台 →「發測試簡訊」
4. DNS 轉過來、第 8 步完成後，兩個環境的 `MITAKE_API_URL` 都改為 `https://sms-relay.storykids.com.tw/api/mtk/SmSend`；主機的臨時網址可以留著或移除

### 8. DNS（storykids.com.tw 轉到 Cloudflare 之後）

Cloudflare → storykids.com.tw → DNS → Add record：

| Type | Name | IPv4 address | Proxy status |
|---|---|---|---|
| A | `sms-relay` | 第 5 步的固定 IP | **DNS only（灰色雲朵）** |

一定要 **DNS only**：Worker 要直接連到這台主機，Caddy 也要直接申請 HTTPS 憑證。

幾分鐘後打開 https://sms-relay.storykids.com.tw/healthz ，看到 `ok` 就完成了。

### 9. Worker 設定

```sh
# 密鑰（第 2 步那組；測試環境要用「發測試簡訊」時也設定一次，去掉 --env production）
npx wrangler secret put SMS_RELAY_KEY --env production
# 三竹帳密（還沒設定的話）
npx wrangler secret put MITAKE_USERNAME --env production
npx wrangler secret put MITAKE_PASSWORD --env production
```

再把 `wrangler.jsonc` 兩個環境的 `MITAKE_API_URL` 改成 `https://sms-relay.storykids.com.tw/api/mtk/SmSend`，push 部署。

### 10. 測試

報名管理後台 →「**發測試簡訊**」→ 輸入自己手機。

| 結果 | 代表 |
|---|---|
| 收到簡訊 | 完成 🎉 |
| 「簡訊轉發主機拒絕請求（HTTP 404）」 | Worker 的 `SMS_RELAY_KEY` 與主機的密鑰不同，或網址路徑錯誤 |
| 「連線逾時或無法連線」 | DNS 還沒生效、防火牆沒開 443，或主機沒開機 |
| `statuscode=e`（帳號密碼錯誤） | 轉發正常，是三竹帳密設定錯誤 |
| 三竹的其他錯誤代碼 | 轉發正常，請對照三竹文件；若是 IP 相關，確認三竹已加白名單 |

### 11. 當機通知

主機 → **Metrics** → 選 **Status check failures** → **Add alarm**（≥ 1 次）→ 開啟 Email 通知。

---

## EC2 台北（三竹要求台灣 IP 時）

轉發設定與啟動指令碼完全相同，只是建立主機的介面不同。第 1～3 步（AWS 帳號、密鑰、`setup.local.sh`）照上方做，接著：

1. **啟用台北區**：右上角帳號 → Account → AWS Regions → Asia Pacific (Taipei) → **Enable**（預設關閉），右上角地區切換到「台北」
2. **Security group**：EC2 → Security Groups → Create：名稱 `storykids-sms-relay`，Inbound 只開 **HTTP 80**、**HTTPS 443**（來源 Anywhere IPv4/IPv6），**不開 SSH**
3. **Launch instance**：

   | 設定 | 選擇 |
   |---|---|
   | Name | `storykids-sms-relay` |
   | AMI | **Ubuntu Server 24.04 LTS**（64-bit Arm） |
   | Instance type | **t4g.nano**（最小的 Arm 主機） |
   | Key pair | Proceed without a key pair |
   | Network settings | Select existing security group → `storykids-sms-relay` |
   | Storage | 8 GiB gp3 |
   | Advanced details → User data | 貼上 `setup.local.sh` 的完整內容 |

4. **固定 IP**：EC2 → Elastic IPs → **Allocate** → 選剛建立的 IP → Actions → **Associate** → 選 `storykids-sms-relay`
5. **自動復原與通知**：主機 → Actions → Monitor and troubleshoot → **Manage CloudWatch alarms** → 條件「Status check failed (system)」→ 動作 **Recover**，並開啟 Email 通知
6. 接著做上方第 7～10 步（三竹白名單、DNS、Worker 設定、測試）

需要登入主機時：主機頁面 → **Connect** → EC2 Instance Connect（需暫時在 security group 開放 SSH 22，用完關閉）。
重建時：用同一份 User data 建立新主機，把 Elastic IP **Associate** 到新主機（IP 不變），再刪除舊主機。

---

## 維護

| 項目 | 方式 |
|---|---|
| 系統安全更新 | 自動（unattended-upgrades，包含 Caddy）；需要時凌晨 4 點自動重開機 |
| HTTPS 憑證 | Caddy 自動申請與更新 |
| 簡訊有沒有送出 | 報名管理後台「紀錄」會顯示每則簡訊成功或失敗 |
| 帳單 | 每月約 US$5，有預算通知 |

### 常見操作（Lightsail 主機頁面 → Connect using SSH，在瀏覽器裡操作）

```sh
cat /var/log/storykids-relay-setup.log     # 安裝紀錄（安裝失敗時看這裡）
sudo systemctl status caddy                # 轉發服務狀態
sudo journalctl -u caddy --since today     # 轉發服務紀錄（不含簡訊內容）
```

### 換密鑰

1. 產生新密鑰（`openssl rand -hex 32`）
2. 主機上：`sudo nano /etc/caddy/relay.env` 改 `RELAY_KEY` → `sudo systemctl restart caddy`
3. Worker：`npx wrangler secret put SMS_RELAY_KEY --env production`（測試環境也要改）

### 主機壞掉重建（約 15 分鐘）

1. 依第 3～4 步建立新主機（同一份啟動指令碼）
2. Networking → 把固定 IP 從舊主機 **Detach**，再 **Attach** 到新主機（IP 不變，三竹白名單不用改）（只做 Detach／Attach，**不要 Release**）
3. 確認 https://sms-relay.storykids.com.tw/healthz 回 `ok`，後台發測試簡訊
4. 刪除舊主機

---

## 台新銷帳檔 sFTP

台新 HTTPS 即時通知每月 NT$5,000，改由台新以 **sFTP** 上傳銷帳檔到這台主機，主機每分鐘轉交給 Worker：

```
台新 ──sFTP（52.194.121.120:2222，帳號 taishin，路徑 /upload）──→ 本主機
本主機 ──HTTPS + 密鑰（TAISHIN_FILE_KEY）──→ 正式環境 Worker /api/taishin/file → D1 bank_files（完整保存原始檔）
```

- 帳號 `taishin` 只能上傳到 `/upload`：不能登入主機、不能執行指令，也看不到其他檔案
- 轉交成功的檔案移到 `/var/lib/taishin/processed/`，保留 90 天；失敗的留在原處，下一分鐘重試
- 同一份檔案重送（台新補檔）只會保存一次
- 解析與對帳等台新「公版格式」規格書（project.yaml T41）；在那之前檔案都完整保存，不會遺失

### 安裝（一次）

1. **轉交密鑰**：自己電腦產生，設定到正式環境 Worker（存進密碼管理工具，等一下主機也要輸入）
   ```sh
   openssl rand -hex 32
   npx wrangler secret put TAISHIN_FILE_KEY --env production
   ```
2. **主機執行安裝**（瀏覽器 SSH，同上方 base64 方式傳檔）
   ```sh
   # 自己電腦
   base64 -b 76 -i relay/sftp-setup.sh | pbcopy
   # 瀏覽器 SSH：輸入下面這行 → 貼上 → Enter → Ctrl+D，再執行
   base64 -d | sudo tee /root/sftp-setup.sh > /dev/null
   sudo bash /root/sftp-setup.sh
   ```
   執行時會詢問：`taishin` 的密碼（＝**申請書上的登入密碼**）、Worker 收檔網址（直接 Enter）、轉交密鑰（＝第 1 步）。
3. **Lightsail 防火牆**：主機 → Networking → IPv4 Firewall → Add rule

   | Application | Protocol | Port | 來源（Restrict to IP address） |
   |---|---|---|---|
   | Custom | TCP | **2222** | 202.6.104.1、202.6.104.10、122.146.23.10、60.244.64.10（台新提供；sFTP 來源 IP 以台新確認為準） |

   ⚠️ **不要**開放給所有 IP。自己要測試時，暫時加上自己的 IP，測完刪除。

### 測試（自己電腦，需暫時在防火牆加自己的 IP）

```sh
echo "test $(date)" > /tmp/ts-test.txt
sftp -P 2222 taishin@52.194.121.120     # 輸入申請書上的密碼
sftp> put /tmp/ts-test.txt /upload/
sftp> bye
```

約 1～2 分鐘後，正式環境報名後台的操作紀錄會出現「收到銷帳檔」；主機上可查看：

```sh
sudo journalctl -u taishin-forward --since today   # 轉交紀錄
sudo ls /srv/sftp/taishin/upload                    # 尚未轉交的檔案（應為空）
```

測完記得把防火牆上自己的 IP 刪除。

### 維護

| 項目 | 方式 |
|---|---|
| 換 sFTP 密碼 | 重新執行 `sudo bash /root/sftp-setup.sh`，詢問時選 y；並向台新申請變更 |
| 換轉交密鑰 | 同上；Worker 也要 `wrangler secret put TAISHIN_FILE_KEY --env production` |
| 轉交失敗 | `journalctl -u taishin-forward`：HTTP 403＝密鑰不同；000＝網路或網址錯誤；檔案會留在 upload 直到成功 |
| 主機重建 | 先跑 setup.sh，再跑 sftp-setup.sh（同樣的密碼與密鑰），固定 IP 改綁新主機 |
