# 樓下匹克球俱樂部 — 私人會員預約系統

私人邀請制的場地預約網站：會員由管理員建立（無公開註冊），會員登入後購買票券、預約場地。

**技術特點：零外部套件。** 只需要 Node.js 22 以上（使用內建 SQLite），不用 `npm install`，`node server.js` 就能跑。

## 功能總覽

**會員端（介面為繁體中文）**

- 首頁為私人俱樂部形象頁（白底綠字＋Logo），點「預約場次」跳出登入視窗
- 登入（Email + 密碼）、邀請信開通帳號、忘記密碼自動寄重設信
- 購買票券：信用卡（綠界 ECPay）或銀行轉帳
- 預約場地：4 面場地 × 每日 09:00–22:00 共 13 個一小時時段，日曆式選日期
- 取消預約：開始前 24 小時以上可取消，票券退回帳戶（不退現金）
- 查看我的票券、預約與訂單

**計價規則（系統自動判定，會員只會看到對應票券與價格）**

| 時段 | 場地 | 票券 | 價格 |
|------|------|------|------|
| 平日 17:00 前 | 全部場地 | 離峰券 | NT$700 |
| 平日 17:00 後・週末・國定假日 | 2・3號場 | 尖峰券(2·3) | NT$1,000 |
| 平日 17:00 後・週末・國定假日 | 1・4號場 | 尖峰券(1·4) | NT$1,200 |

國定假日已內建 2026 年（行政院人事行政總處 115 年行事曆），後台「假日」頁可自行增減；週六日自動採假日價，不需輸入。

**管理端（/admin，用管理員帳號登入自動進入）**

- 總覽：今日預約、待確認轉帳訂單
- 會員：建立會員＋複製邀請連結、重發邀請、停用/啟用、手動調整票券
- 訂單：確認轉帳入帳（自動發放票券）、取消
- 預約：依日期查看全部場地、取消並退券
- 方案：新增/修改票券方案與售價（想做 10 送 1，次數填 11、售價填 10 次價即可）
- 假日：管理國定假日計價

## 本機試跑

```bash
cp .env.example .env      # 編輯 .env（至少改 ADMIN_EMAIL、ADMIN_PASSWORD）
node --no-warnings server.js
# → http://localhost:3000
```

用 `.env` 裡的 ADMIN_EMAIL / ADMIN_PASSWORD 登入即進入後台。

**放 Logo：** 把您的品牌 Logo 存成 `public/logo.jpg`（正方形為佳，例如官網那張綠底 Logo），首頁與登入框就會顯示。沒有這個檔案時版面也正常，只是不顯示圖。

## 部署（推薦 Railway，或 Render / Fly.io / 任何 VPS）

單一 Node.js 服務 + SQLite 檔案資料庫，只要平台支援「持久磁碟 (Volume)」就能跑。

### Railway（最簡單）

1. 把整個資料夾推上 GitHub（`.gitignore` 已排除 `.env` 與資料庫檔）。
2. [railway.app](https://railway.app) → New Project → Deploy from GitHub repo（會自動用 Dockerfile）。
3. 服務 → **Variables**：依 `.env.example` 逐項新增（`BASE_URL` 填 Railway 給的網址或您綁定的網域）。
4. 服務 → **Settings → Volumes**：新增 Volume，Mount path 設 `/data`，並把變數 `DB_PATH=/data/club.db`。
5. 部署完成後開啟網址。綁自訂網域（例如 `club.downstairspickleballclub.com`）在 Settings → Domains，再把 `BASE_URL` 改成該網域。

### Render

Web Service → Runtime 選 Docker，加 **Persistent Disk** 掛載 `/data`，環境變數同上（`DB_PATH=/data/club.db`）。

> ⚠️ 沒有掛 Volume/Disk 的話，每次重新部署會員與預約資料都會消失，務必設定。
> ⚠️ 全站務必走 HTTPS（Railway/Render 預設就有）。

## 金流設定（信用卡怎麼收？）

**運作方式：** 會員在網站選票券方案 → 跳轉到綠界（ECPay）的安全付款頁刷卡 → 綠界通知本系統 → 票券自動入帳。卡號完全不經過您的網站，由綠界處理（這也是台灣多數店家的做法）；款項由綠界依其撥款週期匯入您的銀行帳戶。

**三個階段：**

1. **還沒申請綠界（現在就能營運）：** `.env` 的 ECPAY 欄位留空。會員下單後看到您的轉帳資訊（`BANK_INFO`），轉帳後您在後台「訂單」按「確認入帳」，票券自動發放。
2. **測試刷卡流程：** 填入 `.env.example` 內附的綠界官方測試金鑰（`ECPAY_STAGE=1`），用測試卡號 `4311-9522-2222-2222`（安全碼 `222`、有效期任填未來日期）體驗完整流程，不會真的扣款。
3. **正式收款：** 到 [綠界科技](https://www.ecpay.com.tw/) 申請特約商店（需營業登記；審核約數個工作天），取得 **MerchantID / HashKey / HashIV** 填入 `.env`，`ECPAY_STAGE=0`。綠界端不需再設定網址（本系統每筆訂單都會帶上通知網址 `BASE_URL/pay/ecpay/notify`）。

> 手續費參考：信用卡一般約 2%～2.75%（依方案與談判），詳情以綠界報價為準。也可考慮藍新 NewebPay、TapPay，架構類似，但本系統目前串接的是綠界。

## Email 自動寄送（邀請信＋忘記密碼信）

系統內建 SMTP 寄信（零套件），設定好後：

- **建立會員** → 系統自動寄出品牌樣式的邀請信，會員點「設定密碼並開通帳號」按鈕 → 設密碼 → 直接登入。
- **忘記密碼** → 會員在網站輸入 Email → 自動收到重設連結（2 小時有效、單次使用、換密碼後全裝置登出）。
- **未設定 SMTP 也能營運**：後台會顯示邀請連結，複製用 LINE 傳給會員即可；忘記密碼則引導聯絡客服。

**用 Gmail 設定（最快）：**

1. Google 帳戶 → 安全性 → 開啟「兩步驟驗證」。
2. 搜尋「應用程式密碼 App passwords」→ 產生一組 16 碼密碼。
3. `.env` 填入：

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=downstairspickleballclub@gmail.com
SMTP_PASS=（剛產生的16碼，去掉空格）
MAIL_FROM=樓下匹克球俱樂部 <downstairspickleballclub@gmail.com>
```

> Gmail 免費帳號每日寄信上限約 500 封，對俱樂部綽綽有餘。若未來量大或要用自有網域寄信（提升到達率），可改填 Brevo、Mailgun 等服務的 SMTP 資訊，欄位相同。

## 日常營運流程

1. **新會員**：後台「會員」→ 輸入姓名 Email → 建立 → 系統自動寄邀請信（或複製連結傳 LINE）→ 會員設定密碼即完成開通。
2. **收款**：刷卡自動入帳；轉帳單在「訂單」按「確認入帳」。
3. **看場地**：後台「預約」選日期即可看四面場地整日狀況；可代會員取消並退券。
4. **補償/實體售券**：後台「會員」→ 調整票券（可加可減，附備註）。
5. **會員無法登入**：會員可自行用「忘記密碼」收信重設；或後台按「重發邀請」。
6. **每年 12 月**：「假日」頁依人事行政總處公告輸入次年國定假日。

## 備份與安全

- 資料都在一個檔案：Volume 裡的 `club.db`（含 WAL 檔）。定期下載備份即可。
- `ADMIN_PASSWORD` 只在首次啟動建立管理員時使用；上線後請改用強密碼並妥善保管。
- 密碼以 scrypt 雜湊儲存；登入有頻率限制；表單有同源檢查；綠界回傳有簽章驗證。

## 檔案結構

```
server.js          主程式（路由、session、伺服器）
src/db.js          資料庫結構與初始資料（node:sqlite）
src/pricing.js     計價規則（時段/場地/假日 → 票券類型）
src/ecpay.js       綠界金流（CheckMacValue、付款表單、回傳驗證）
src/mailer.js      SMTP 寄信（邀請信、重設密碼信，零套件）
src/auth-util.js   密碼雜湊（scrypt）與亂數 token
src/html.js        全部頁面模板（繁體中文）
public/style.css   樣式（白底綠字，對應品牌）
public/logo.jpg    ← 請自行放入您的 Logo
```
