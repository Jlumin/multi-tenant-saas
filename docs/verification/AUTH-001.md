# AUTH-001 驗證報告

日期：2026-10-26（Asia/Taipei）。Issue #4；分支 feat/auth-001；依賴 M0 PR #3（925ce0ab8ed934de1cf4e24b10c0e447a0ebabda）。使用者確認 Google 與電子郵件／密碼，未確認租戶加入政策，因此只實作身分整合。

## 已執行結果

環境：Linux Docker，Node 24.22.1 / npm 11.19.1，PostgreSQL 17.11、Mailpit 1.32.0。沿用 M0 工具，新增 Better Auth 1.7.13 / Prisma Client+adapter 7.10.1 / Nodemailer 10.2.1 / React hooks lint 7.1.1。鎖檔固定版本，沒有正式 secrets。

| 指令 | 本機結果 |
|---|---|
| npm ci | 通過；371 packages，postinstall 產生 Prisma Client |
| npm run lint | 通過；Next/TypeScript/JS/React hooks recommended rules |
| npm run typecheck | 通過；next typegen + tsc --noEmit |
| npm test | 10/10：health、auth config、路由白名單／遮罩／泛化錯誤 |
| npm run db:validate | Prisma schema valid |
| npm run db:smoke | 真實新 PostgreSQL DB，2 個 migration、第二次 deploy 不變、schema diff 空，最後清理 |
| npm run test:auth | 9/9 真實 PostgreSQL + Better Auth 測試；只替換郵件投遞，不替換登入、hash、session 或驗證邏輯 |
| npm run test:http -- --dev | 真實 Next dev 首頁及 health 200、POST 405 |
| npm run build | 成功，含 /sign-in、/reset-password、動態 auth routes |
| npm run test:http | 真實 Next production 首頁及 health 通過 |
| npm run test:auth:http | 真實 Next production + Prisma/PostgreSQL + Nodemailer SMTP + Mailpit，註冊→驗證→登入／session→登出全通過 |
| npm audit | 當次 registry 回報 0 vulnerabilities |

Auth integration 涵蓋未驗證／錯誤密碼／外部 Origin 拒絕、HttpOnly/SameSite cookie、偽造 cookie、到期 session、無效與重用重設 token、重設撤銷 session、登出撤銷、Google 未配置拒絕、provider identity 唯一、實際限流。另以測試憑證僅產生 Google 授權 URL（不呼叫 Google），驗證 state、S256 PKCE、固定 callback，錯誤 state 拒絕。

測試建立並只清理自身 bootstrap_test_*、auth_test_*、auth_http_* 資料庫。驗證後查 pg_database 沒有這些名稱遺留。M0 tenants migration 與原 README 均未修改，新增 migration 只有 auth schema，沒有 reset 或正式資料操作。

## 修正與未驗證

首輪測試發現 Better Auth 的 PostgreSQL UUID 策略需要 DB 預設，已補 gen_random_uuid 並重產未發布 migration；登入限流也確實在串行測試間生效。以測試 Date 時鐘推移情境，不關閉正式限流，另有明確 429 測試。

測試補上了實際 GET reset token 路徑白名單與不可變 redirect headers 處理；測試確認 request log 不含 URL token。Next dev URL logging 與原始 auth logger 已停用，錯誤僅輸出 metadata/request ID。

**真實 Google OAuth 尚未驗證**：沒有客戶端 ID/secret 與人工 Google 登入；授權 URL fixture、state/PKCE/callback 失敗測試不代表 Google 同意與 callback 成功。Google 設定／人工驗證步驟見 AUTHENTICATION.md。

正式 SMTP、MFA、分散式限流、租戶加入／邀請、membership/角色、租戶隔離 API、業務 CRUD、RLS、部署與資料留存仍未交付。session metadata 包含套件的 IP/user-agent，正式環境需要另訂資料保留政策。

GitHub Actions 實際結果以 Draft PR checks 與 PR 內連結為準；不能把本機成功寫成未執行的遠端成功。PR 保持 Draft，待依賴合併與真實 Google 人工驗證，不自行推送 main／合併／部署。
