# TENANCY-001 驗證報告

日期：2026-10-26（Asia/Taipei）。Issue #6；分支 feat/tenancy-001，由 AUTH-001 的 094baf02671c37817601a8434964adb07c6c40b1 建立。使用者確認「管理員建立租戶並邀請成員」。

## 本機結果

環境：Linux Docker、Node 24.22.1、npm 11.19.1、PostgreSQL 17.11、Mailpit 1.32.0。新依賴僅 tsx 4.23.15，用於執行共用 TypeScript 維運 CLI，已更新鎖檔。

| 指令／項目 | 結果 |
|---|---|
| npm ci | 乾淨安裝通過，374 packages；Prisma Client 自動產生 |
| npm run lint / typecheck | 通過，含 React hooks 與 Next typegen |
| npm test | 10/10 通過，既有 auth/config/handler/health |
| npm run test:auth | 23/23 通過：9 個 auth、14 個新增 tenancy PostgreSQL 測試 |
| npm run db:validate | schema valid |
| npm run db:smoke | 三份 migration；空庫建立、重複 deploy 不變、schema diff 空；既有 tenants 欄位與新增 is_active 預設通過 |
| npm run test:http -- --dev | 真實 dev 首頁／health 200、POST 405 |
| npm run build / test:http | production build 與首頁／health HTTP smoke 通過 |
| npm run test:auth:http | 真實 production server + PostgreSQL + Nodemailer SMTP/Mailpit，兩個帳號的完整邀請流程通過 |
| npm audit | 當次 registry 0 vulnerabilities |
| 原檔 | README、M0 與 AUTH migrations 完全未變更 |

新 tenancy 測試使用真實 Better Auth signed sessions／DB session lookup，不使用自訂身分 header 或公開 fake login。涵蓋：匿名／偽造身分拒絕、兩租戶列表／單筆／管理跨租戶 404、Member 管理 403、Origin/未知 body field/role/pagination 拒絕、token 只存 hash、收件 email 匹配、過期／撤銷／重邀／重播、併發接受只成功一次、兩 Owner 併發降權保留一位、停用成員與 Tenant、未驗證使用者及失效簽發 Owner、SMTP 失敗補償、審計 metadata、audit 故障 transaction rollback、複合 FK／role enum／identity guard／append-only guard、20/h 限額及真實 CLI。

HTTP smoke 實際依序執行：註冊／驗證第一個帳號→登入→CLI 建 Tenant 與 Owner→寄邀請到 Mailpit→第二個帳號註冊／驗證→加入前 404→接受後租戶 200→Member 管理 403→token 重播 400→登出。也確認 /workspaces 與 /invite 回 200。這是 HTTP/server 整合驗證，未宣稱已完成瀏覽器所有互動／視覺 E2E。

測試庫 bootstrap_test_*、auth_test_*、tenancy_test_*、auth_http_* 都由測試自行建立後清理，查 pg_database 沒有遺留。未 reset、沒有對開發 volume 套用第三份 migration，也沒有操作正式資料；開發既有 M0 migration history 保留。

## 已知限制與審查

本機安裝在 OpenSSL 未就緒時曾出現 Prisma 警告，補裝 OpenSSL/CA 後完成乾淨安裝及全部驗證，沒有關閉 TLS。邀請接受額外核對簽發 Owner 仍為已驗證使用者，避免後續失權的邀請被使用。

GitHub Actions 的實際成功連結由 Draft PR 驗收表提供，本機通過不能取代未執行的遠端結果。PR 依賴 #5/#3/#2，均不由本次合併，不推 main、不部署。

M1 的租戶／身分工程可供審查，**真實 Google OAuth 仍未驗證**，正式 SMTP、RLS、業務 CRUD、正式 DB 角色分權、資料留存與部署尚未驗收。沒有跨租戶超級管理 API。UI 有載入筆數上限，完整 API 分頁可用；寄信採 transaction 後投遞與失敗撤銷，沒有 outbox／自動重試，不能保證 DB+SMTP 原子性。
