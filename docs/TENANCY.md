# TENANCY-001 操作與驗證

先完成 AUTHENTICATION.md 的 secret、資料庫、SMTP/Mailpit 設定；使用相同 BETTER_AUTH_URL origin。保留 README，無預設管理員或跨租戶超級權限。

## 第一個租戶

使用者先註冊、驗證並登入。在帳號頁展開「提供給管理員的帳號識別碼」，將 User UUID 交給可信維運管理員。管理員在有 DB 權限的開發／維運終端執行：

```sh
npm ci
npm run db:deploy
npm run tenant:provision -- --name "測試公司" --slug test-company --owner-user-id "<已驗證使用者 UUID>"
```

這只建立新租戶，不覆寫重複 slug、不替未知／未驗證帳號建 Owner，不建立密碼。失敗 transaction rollback，輸出只含 Tenant ID 或通用錯誤。CLI 使用 tsx 4.23.15 執行共用 TypeScript service；須安裝 dev dependencies，並視為有 DB 寫入權的可信維運工具，不是 Web 使用者的功能。

## 邀請與管理

到 `/workspaces`，選擇工作空間。Owner 可看到成員、邀請與審計，邀請時選 Member 或 Owner。選 Owner 會委派該租戶的成員與邀請管理權。Member 只看到工作空間基本資料，沒有管理操作。

收件者到 Mailpit http://localhost:8025 開啟邀請信，先用收件地址登入／註冊並完成驗證，再回到原邀請連結接受。信內連結為 `/invite?token=...`，只在接受成功後回傳 tenantId；token 不回傳至建立邀請 API，不寫入 localStorage。接受後從工作空間列表選取。

邀請 24 小時有效；同 email 重邀會撤銷舊連結。撤銷、過期、已使用、email 不符、未驗證、簽發 Owner 已失權、停用租戶均拒絕；錯誤不公開他人的邀請 email 或租戶資訊。寄送失敗回 502，請修正 SMTP 後重新寄送，不從 DB 取 token（只存 hash）。每 Owner／租戶每小時上限 20 份。

變更角色／啟停成員立即影響下一個 API 請求，介面會清除目前工作空間並要求重新選取；已進行中的 GET 以其授權檢查時的狀態為準。最後一位有效 Owner 受保護，不能同時將所有 Owner 移除。沒有刪除 Tenant/User 的 UI。

UI 最多載入 100 個工作空間／成員、最近 50 邀請／審計，明示總數；API 支援 limit/offset，尚無完整 UI 分頁。正式大型租戶管理另議。

## API

前綴 `/api/tenancy`；需要已驗證 session。修改需同源 Origin + application/json；不信任自訂 user/tenant headers。列表為 `{items,total,limit,offset}`，limit 1–100、offset 0–100000。

| 方法與路徑 | 權限／用途 |
|---|---|
| GET / | 只列自己的 active memberships + active tenants |
| GET /{tenantId} | 有效成員查看該租戶基本資料 |
| GET /{tenantId}/members | Owner，僅本租戶 |
| PATCH /{tenantId}/members/{userId} | Owner，body role(owner/member)、isActive |
| GET /{tenantId}/invitations | Owner，沒有 token 或 hash |
| POST /{tenantId}/invitations | Owner，body email、可選 role（預設 member） |
| POST /{tenantId}/invitations/{id} | Owner，以空 JSON 撤銷 |
| POST /accept | 已驗證收件者，body token |
| GET /{tenantId}/audit | Owner，唯讀 ID/action/time metadata |

沒有 POST / 建租戶功能。未登入 401、角色不足 403、沒有租戶資格或外租戶物件 404、最後 Owner／已是成員 409、錯誤邀請／payload 400、邀請次數 429、SMTP 502、未預期依賴錯誤 503。回 `{error:{code,requestId}}`，不回 DB 詳情。

## 驗證與停止

```sh
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

test:auth 現在包含 tenancy.postgres.ts：使用真實 Better Auth signed session 與 PostgreSQL，只有投遞為測試 mailbox。包含兩租戶、Owner/Member/非成員、偽造 header/body、token 及最後 Owner 並發、DB FK/enum/trigger、審計失敗 rollback、SMTP 失敗撤銷與實際 CLI。

test:auth:http 加入真正 production HTTP + SMTP/Mailpit 的維運 CLI→邀請→第二帳號註冊／驗證→接受→Member 管理拒絕→重播拒絕→登出。測試庫均隨機命名且只清理自身新庫，沒有 reset 既有資料。停止服務沿用 db:stop / db:down，保留 PostgreSQL volume。

真實 Google OAuth、正式 SMTP、RLS、業務 CRUD、MFA、分散式入口限流、DB runtime 角色分權與留存政策仍未驗收；安全取捨見 ADR 0003。
