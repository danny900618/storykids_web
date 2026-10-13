# 三竹簡訊轉發主機（AWS Lightsail）

三竹的簡訊 API 只接受**白名單內的固定 IP**，Cloudflare Worker 沒有固定 IP（實測連線會被直接丟掉）。
所以租一台有固定 IP 的小主機，專門把 Worker 的簡訊請求轉給三竹：

```
Worker ──HTTPS + 密鑰──→ 轉發主機 sms-relay.storykids.com.tw（固定 IP）──→ 三竹 smsapi.mitake.com.tw
```

| 檔案 | 用途 |
|---|---|
| [Caddyfile](Caddyfile) | 轉發設定：只接受帶密鑰的 `POST /api/mtk/SmSend`、只轉給三竹、自動 HTTPS、不記錄內容 |
| [setup.sh](setup.sh) | Lightsail 啟動指令碼：開機自動安裝 Caddy、寫入設定、開啟自動安全更新 |

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
openssl rand -hex 32
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

### 5. 固定 IP

Lightsail → **Networking** → **Create static IP** → 選 `storykids-sms-relay` → 建立。記下這個 IP。

⚠️ 固定 IP **要一直綁在主機上**（免費）；沒綁主機時 AWS 會收費。

### 6. 防火牆

主機 → **Networking** 分頁 → IPv4 Firewall（IPv6 Firewall 也做一樣的設定）：

| 規則 | 設定 |
|---|---|
| HTTPS 443 | 保留（Worker 連進來） |
| HTTP 80 | **新增**（申請 HTTPS 憑證需要） |
| SSH 22 | 改為只允許 **Lightsail browser SSH**（勾選 Restrict to Lightsail browser SSH） |

### 7. 三竹白名單

把第 5 步的固定 IP 給三竹，請他們加入白名單。

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
2. Networking → 把固定 IP 從舊主機 **Detach**，再 **Attach** 到新主機（IP 不變，三竹白名單不用改）
3. 確認 https://sms-relay.storykids.com.tw/healthz 回 `ok`，後台發測試簡訊
4. 刪除舊主機
