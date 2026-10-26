# ADR 0002：Google 與電子郵件／密碼

日期：2026-10-26。使用者已確認兩種登入方式；租戶加入政策仍待另一項選擇。此決策只涵蓋 AUTH-001 / #4，依賴 M0 PR #3，不代表整個 M1 完成。

## 決策與依賴

採 Better Auth 1.7.13，Prisma Client / PostgreSQL adapter 7.10.1，沿用 Next 16、Node 24、Prisma 7。套件處理密碼 hash、session cookie、CSRF/origin、OAuth state、驗證／重設 token；不自行實作加密。Nodemailer 10.2.1 供 SMTP；Mailpit 1.32.0 以固定 digest 作本機／CI 收件服務。React hooks lint 7.1.1 支援 ESLint 10，隨互動 UI 一起加入。

原 DATABASE.md 的 users.auth_subject 為提案，無法直接表達同一使用者多種登入來源。改為套件標準 User/Account/Session/Verification 模型，實際表名為 auth_users、auth_accounts、auth_sessions、auth_verifications；User UUID 全域身分，Account unique(provider_id,account_id) 表達來源 subject，不建立全域 tenant role。只新增第二份 migration，保留 tenants 表與第一份 migration。

使用 Better Auth UUID 策略與 DB gen_random_uuid 預設，讓 adapter 可略過 id 並由 DB 產生。User email 唯一，套件負責正規化。密碼在 Account 僅存套件 hash；OAuth tokens 啟用套件加密。全域帳號不會自動產生 Tenant/Membership，不能由「已登入」推導租戶授權。

## 安全與邊界

- 電子郵件必須完成驗證才可密碼登入；註冊不自動登入。密碼 12–128 字元。
- 8 小時 DB session，HttpOnly、SameSite=Lax；HTTPS origin 啟用 Secure，HTTP 僅准 loopback。沒有 localStorage session。重設密碼撤銷 session。
- 固定 BETTER_AUTH_URL 與 trustedOrigins，不從任意 Host 推導回呼。Google 未配置不加入 provider；只設一半憑證拒絕初始化。
- 帳號自動連結與跨 email linking 均不開放；相同 email 的 Google 與密碼帳號不默默合併。帳號連結 UX 後續另議。
- 只掛載本 Issue 的路徑白名單，未公開套件的帳號刪除／連結／OAuth token API。session middleware 不提供 tenant context。
- 登入保留套件的嚴格 endpoint 限流，另設單程序記憶體基線。正式多實例／可信代理來源仍需專案決策，不宣稱分散式限流。
- 關閉 Next dev URL logging 與套件原始 logger；只記 request ID、固定動作路徑、狀態碼。重設 URL 路徑 token 先遮罩，錯誤不回傳 env 或 DB 詳情。
- Mailpit 只收本機／CI 測試郵件，綁 localhost；不用真實外部收件者測試。遠端 SMTP 必須 STARTTLS 或 implicit TLS，維持 CA 驗證。

## 尚未驗證／待定

未有真實 Google OAuth credentials，未執行真實 Google 同意／登入，不能把設定與錯誤回呼測試當成外部驗證成功。正式 SMTP、部署、MFA、共享限流、審計外送／留存、租戶加入與角色均不在此交付。

依據：[Better Auth Prisma](https://better-auth.com/docs/adapters/prisma)、[email/password](https://better-auth.com/docs/authentication/email-password)、[Google](https://better-auth.com/docs/authentication/google)、[Options](https://better-auth.com/docs/reference/options)。
