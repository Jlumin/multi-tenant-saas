# 本機開發與驗證

BOOTSTRAP-001 建立 Web、健康檢查、PostgreSQL tenants schema 與 CI；AUTH-001 新增 Google／電子郵件密碼的身分整合，見 [AUTH 開發指南](AUTHENTICATION.md)。TENANCY-001 加入租戶選擇、Owner/Member 與邀請，見 [TENANCY 指南](TENANCY.md)。PROJECTS-001 新增 [Project 專案管理](PROJECTS.md)，需套用第四份 migration；WMS、RLS、Agent 與正式部署尚未實作。保留根目錄 README 原內容；初始工具鏈見 [ADR 0001](adr/0001-bootstrap-toolchain.md)。

## 先決條件與安裝

- Git、Node **24.22.1**、npm **11.19.1**；版本設定在 .nvmrc / package.json。
- Docker Engine/Desktop（Linux containers）與 Docker Compose v2；啟動 PostgreSQL 前確認 Docker 正在執行。
- PowerShell、bash 等終端；以下跨平台 npm 指令相同，檔案複製及環境變數語法分開標示。

在此儲存庫根目錄執行（不要使用先前 SME Cloud 的資料夾）：

```sh
node --version
npm --version
npm install --global npm@11.19.1
npm ci
```

npm ci 僅安裝 lockfile 內版本，不修改鎖檔，postinstall 會產生 Prisma Client。無需正式秘密或資料庫即可安裝、lint、型別檢查、單元測試及 build；實際登入需另外設定 AUTHENTICATION.md 的環境。第一次安裝需要 npm registry 與 Prisma engine 下載網路。

## 環境設定

PowerShell：

```powershell
Copy-Item .env.example .env
```

bash：

```sh
cp .env.example .env
```

若已存在 .env，保留原檔並逐項確認，不覆蓋。範例帳密僅供本機虛構資料，正式環境不可使用。`.env*` 已忽略（只允許 .env.example），不要在 NEXT_PUBLIC_* 放入 DATABASE_URL 或秘密。

| 變數 | 用途 |
|---|---|
| POSTGRES_DB / USER / PASSWORD | 新建本機 PostgreSQL volume 時初始化 |
| POSTGRES_PORT | 本機綁定 127.0.0.1 的 port，預設 55432 |
| DATABASE_URL | 僅供手動 db:deploy/db:status/db:validate 的開發資料庫 |
| TEST_DATABASE_ADMIN_URL | db:smoke 專用連線；帳號需 CREATEDB，腳本自行建立全新隨機測試庫 |

變更 port、帳密、database name 時，同步調整連線 URL。帳密的特殊字元需 URL encode。Prisma CLI / smoke script 以 dotenv 讀取 .env；shell 已設定的變數優先。不要將遠端或正式資料庫連線放進這份本機範例。

## PostgreSQL 與 migration

```sh
npm run db:up
npm run db:validate
npm run db:deploy
npm run db:status
```

db:up 啟動本專案 PostgreSQL（本機 55432）與 Mailpit，與其他 Compose 專案隔離。資料保存在本專案 postgres_data volume。db:deploy 是 Prisma migrate deploy，套用版本化 SQL，不使用 db push 或 reset。依序建立 tenants、auth 身分、membership/invitation/audit、projects；schema 與 SQL 一起提交。

tenants 欄位：UUID id（DB gen_random_uuid 預設）、name、unique slug、created_at（timestamptz，預設現在時間），全部 NOT NULL。AUTH-001 另增 auth_* 表，不改動既有 migration；仍不提供建立或查詢租戶的 API。db:up 現在也會啟動本機 Mailpit，詳見 AUTH 指南。

重跑 `npm run db:deploy` 不應產生新 migration；`npm run db:status` 應為 up to date。已有 volume 時變更 POSTGRES_PASSWORD 不會重設既有帳密；請使用原本連線設定或另建明確隔離的開發專案，不刪除用途不明的 volume。

## 啟動與停止 Web

```sh
npm run dev
```

開啟 http://127.0.0.1:3000 ，GET http://127.0.0.1:3000/api/health 回 HTTP 200、固定 `{ "status": "ok" }`，Cache-Control: no-store。這是 liveness，不代表 DB readiness。首頁不需要 DB；沒有假登入或預設管理員。實際登入請使用 BETTER_AUTH_URL 指定的相同 origin（預設 http://localhost:3000/sign-in）。

dev/start 預設僅綁定 127.0.0.1。停止 Web 使用 Ctrl+C。若 3000 被占用，可用 `npm run dev -- --port 3001` 並以日誌顯示的 port 為準。

## 驗證

```sh
npm run lint
npm run typecheck
npm test
npm run db:smoke
npm run test:http -- --dev
npm run build
npm run test:http
```

- typecheck 先執行 next typegen，因此乾淨 checkout 不依賴舊的 .next/types。
- npm test 以 Vitest 直接呼叫實際 GET route handler，驗證 HTTP Response、200、固定 JSON、Content-Type 與 no-store。
- db:smoke 使用 TEST_DATABASE_ADMIN_URL 建立 `bootstrap_test_<random UUID>` 資料庫，不把 migration 套到 DATABASE_URL。驗證新庫為空後 deploy，檢查欄位型別／NOT NULL、UUID／時間預設、主鍵與 slug 唯一約束、兩筆虛構租戶，再重跑 deploy 比較 migration history、執行 status 與 Prisma diff 檢查 schema 一致。finally 只 drop 此次成功 create 的測試庫。不得改成 reset 既有資料庫。
- test:http 自動挑空閒本機 port，啟動真正 Next dev 或 start，驗證首頁、GET /api/health 與不支援的 POST 405，完成後停止自己啟動的程序。production 模式需先 build。不要與另一個 dev/build 同時操作同一個 .next 目錄。
- 測試不需正式 secrets。錯誤訊息不印連線 URL；連線錯誤請在本機檢查設定，不把敏感輸出貼入 PR。

若 PostgreSQL 使用另一個 port，修改 .env；CI 透過獨立 PostgreSQL service、虛構帳密與固定工具版本執行相同檢查。CI 是 pull_request（包含文件分支為 base 的 PR）及 main push 觸發，權限僅 contents:read，沒有部署步驟。

## 停止資料庫與清理

```sh
npm run db:stop
# 需要移除已停止的 container/network 時：
npm run db:down
```

兩者保留 volume；重新啟動用 db:up。不要對用途未確認的資料使用 `down -v`、`prisma migrate reset` 或 DROP DATABASE。db:smoke 會清理自身測試庫；若程序被強制中止而留有 bootstrap_test_*，先確認名稱、用途與沒有其他測試連線，再由操作者個別處理，不用萬用字元清理。

## 常見錯誤

- Node/npm engines 不符：切換 .nvmrc 的 Node 並安裝指定 npm，勿跳過 engine-strict。
- Docker daemon unavailable：先開啟 Docker Desktop 並等待 Engine running。
- Windows docker-credential-desktop 無法執行：可對公開映像使用獨立設定 `docker --config .docker-local compose up -d --wait`（先確認 .env 存在）；不修改全域登入設定。
- 55432 被占用：調整 POSTGRES_PORT 與兩個 URL，不能只改其中之一。
- Prisma 缺 DATABASE_URL：確認已複製 .env、目前位於 repo 根目錄；CI 或工具容器需明確傳入環境變數。
- db:smoke 連線／CREATEDB 失敗：確認 TEST_DATABASE_ADMIN_URL 指向本機測試 PostgreSQL，帳號能建立新測試庫；不改用正式高權限帳號。
- Linux Prisma engine 缺 OpenSSL：使用具 OpenSSL 的 Node 發行環境，或在一次性 Debian 工具容器安裝 openssl；不是關閉 TLS 驗證。
- health 200 但 DB 失敗：這是預期分工，health 不驗證資料庫，另跑 db:smoke。
- CI 無執行結果：確認 Actions 啟用，若外部 PR 需要批准，由維護者處理；未執行不能標示通過。

本機驗證與 PR CI 證據見 verification/ 的各 Issue 報告。真實 Google 登入已人工確認；邀請寄信真人補驗依使用者要求延後至整體建置完成，追蹤 QA-001 / #8；不代表正式郵件或部署已驗收。Project 介面位於 /projects，測試沿用原 CI 指令；test:auth 已包含 projects.postgres.ts，HTTP/SMTP smoke 也涵蓋 Project CRUD 與跨租戶拒絕。
