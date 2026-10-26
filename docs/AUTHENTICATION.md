# AUTH-001 開發與驗證

已加入 Google 與電子郵件／密碼身分整合；租戶成員／角色與資料存取仍未實作。依賴 PR #3，首次使用先讀 DEVELOPMENT.md。原 README 保留。

## 本機啟動

1. 使用 Node 24.22.1 / npm 11.19.1，執行 npm ci（自動 prisma generate）。
2. 依 DEVELOPMENT.md 複製 .env.example 至 .env，保留原本已有設定。
3. 以 `openssl rand -base64 32` 或可信秘密產生器建立私密值，填入 .env 的 BETTER_AUTH_SECRET，不提交、不貼到 PR。範例不提供可用預設 secret。
4. BETTER_AUTH_URL 預設 http://localhost:3000；必須與瀏覽器使用 origin 相同，不能混用 localhost / 127.0.0.1 或隨意變 port。遠端必須 HTTPS。
5. `npm run db:up` 啟動 PostgreSQL 與 Mailpit；`npm run db:deploy` 套用新增 auth migration。不要 reset 或移除現有 volume。
6. `npm run dev`，開啟 http://localhost:3000/sign-in 。

SMTP 預設 127.0.0.1:1025、無帳密，Mailpit 收件匣 http://localhost:8025 。只使用虛構 @example.test 地址作本機驗證；郵件不寄到外部。註冊後到 Mailpit 開啟驗證連結，再登入。忘記密碼同樣從收件匣取重設連結；密碼更新會使舊 session 失效。Mailpit 中的連結屬敏感 token，不分享收件匣內容。

SMTP_HOST / PORT / SECURE / FROM 皆在 .env 設定，SECURE 使用 1 或 0；USER/PASSWORD 必須同時配置或同時空白。只有 loopback／本機 mailpit 允許無 TLS 開發 SMTP；其他 host requireTLS。此設定不代表已選定正式郵件供應商。

## Google 設定與人工驗證

在自己的 Google Cloud OAuth Web application 設定 client ID/secret，僅寫入本機 .env 的 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET。Authorized redirect URI 以同一 origin 加 `/api/auth/callback/google`，預設 http://localhost:3000/api/auth/callback/google 。變更後重啟 dev。

兩項空白時 Google 按鈕停用；只配置一項會拒絕啟動 auth service。自動化測試不使用正式憑證。操作者需另行驗證：真實 Google 登入／取消、回呼、登出、已存在同 email 密碼帳號的拒絕連結行為。Google 憑證建立、同意畫面與人工登入尚未由本 PR 代辦。

## 路徑與錯誤

- `/sign-in`：Google、密碼登入、註冊、忘記密碼；`/reset-password`：重設連結的目標頁。
- `/api/auth/[...all]`：有限白名單的 Better Auth routes（sign-up/email、sign-in/email、sign-in/social、get-session、sign-out、verify-email、send-verification-email、request-password-reset、reset-password 與其 GET token 連結、callback/google、error）。
- `/api/auth-capabilities`：只回 Google 是否已配置，不回憑證或環境內容。
- 缺 secret／SMTP／DB 等設定時 auth 回泛化 503；`/api/health` 仍固定 200，不讀 DB，也不證明登入可用。
- 不信任同 email 自動 linking，不開放額外 account/token 管理 API。帳號可建立，但不代表可建立／加入租戶。

## 測試與 CI

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run db:validate
npm run db:smoke
npm run test:auth
npm run test:http -- --dev
npm run build
npm run test:http
npm run test:auth:http
```

test:auth 用 TEST_DATABASE_ADMIN_URL 建新的 auth_test_<UUID> disposable DB，執行真實 Better Auth handler + Prisma；只有郵件「投遞」換成記憶體收件匣。測試驗證信、密碼 hash、未驗證／錯誤密碼／跨 Origin 拒絕、cookie/session、登出、到期、一次性重設、重設撤銷 session、Google 未配置與 state/callback 拒絕、provider identity 唯一及限流。只將 Date 時鐘向前推移隔離情境，不停用限流。

test:auth:http 需 PostgreSQL、Mailpit、完成 build。透過 TEST_MAILPIT_URL 查本機測試收件匣，自建 auth_http_<UUID> DB 並啟動真正 Next production server；使用隨機 test secret／虛構帳號，實際經 Nodemailer SMTP→Mailpit→驗證連結→登入→session→登出。結束只移除自己的新 DB／程序，不清空既有 inbox 或資料庫。腳本不印帳密或 token。

CI 加入固定 Mailpit service 與上述測試，不需要 BETTER_AUTH_SECRET／Google 正式 secrets。測試當下自建短效 secret，只存在子程序環境。Google 真實登入保持未驗證，不能將 fixture 授權網址測試當成實際外部成功。

停止用 `npm run db:stop` 或 `npm run db:down`，保留 PostgreSQL volume；Mailpit 沒有持久化設定，開發容器移除時收件匣消失。安全決策與限制見 ADR 0002。
