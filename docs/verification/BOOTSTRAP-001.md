# BOOTSTRAP-001 驗證證據

日期：2026-10-26（Asia/Taipei）。Issue：[Jlumin/multi-tenant-saas#1](https://github.com/Jlumin/multi-tenant-saas/issues/1)。

來源：`docs/gpt-pm-bootstrap-20261026`，commit `2acb941e36b4eb834457fe7444fe6d2a917912f5`。
實作：`feat/bootstrap-001`。文件 PR #2 尚未合併時，Draft PR 以文件分支為 base。

## 本機環境與精確結果

Windows 主機 Docker Engine 26.0.0；驗證於乾淨 Linux 容器目錄（不複製 host node_modules、.next、.git 或 .env）進行。Node 24.22.1、npm 11.19.1、Next 16.4.3、React 19.3.1、Prisma 7.10.1、TypeScript 5.9.3、Vitest 5.0.5、ESLint 10.13.0、PostgreSQL 17.11。一次性 Debian slim 工具容器補裝 OpenSSL 與 CA 憑證；沒有關閉 TLS 憑證驗證。

| 驗收 | 指令／證據 | 結果 |
|---|---|---|
| 可重現依賴、Node 版本 | package.json 精確版本、package-lock.json、.nvmrc、.npmrc；乾淨目錄 npm ci | 通過，308 packages，未使用 force / legacy-peer-deps |
| dev 首頁及固定健康狀態 | npm run test:http -- --dev | HTTP 200 首頁、GET 固定 JSON/no-store；POST 405 |
| endpoint 測試 | npm test | 1 個檔案、2 個測試通過（實際 route handler） |
| 秘密檔案保護 | git check-ignore .env .env.local .env.production；範例不忽略 | 通過；只有虛構本機範例，未提交真實秘密或客戶資料 |
| 本機 PostgreSQL 啟動 | docker compose --env-file .env.example up -d --wait | healthy；localhost:55432，獨立專案 volume |
| 版本化 migration | npm run db:validate；npm run db:deploy；再次 db:deploy；npm run db:status | valid；首次成功；第二次 No pending migrations；up to date |
| 真實 PostgreSQL smoke | npm run db:smoke | 全新隨機測試庫；欄位／約束／預設／migration history／schema diff 全通過；測試庫移除 |
| lint | npm run lint | 通過、零 warnings |
| 型別 | npm run typecheck | next typegen + tsc --noEmit 通過 |
| production build | npm run build | 通過；首頁 static、/api/health dynamic |
| production HTTP | npm run test:http | HTTP 200 首頁、GET 固定 JSON/no-store；POST 405 |
| 依賴檢查（附加） | npm audit | 0 vulnerabilities（當次 registry 結果） |
| README 與分支 | git diff --exit-code docs/gpt-pm-bootstrap-20261026 -- README.md | 完全未變更 |
| CI 與交付 | pull_request／main push workflow；Node/npm/action SHA/PostgreSQL digest 固定；contents:read | 實際 GitHub 結果以 Draft PR checks 與 PR 驗收表連結為準，不能將本機成功當作遠端成功 |

DB smoke 額外確認：tenants 初始不存在；4 欄型別與 NOT NULL；DB 產生 UUID v4 與時間；slug／PK 重複及 null 欄位被拒絕；兩筆虛構租戶保留；第二次 deploy 的 migration name/checksum/finished_at 完全一致；Prisma migrate diff 無差異。僅 CREATE／DROP 腳本自身建立的 bootstrap_test_<UUID>，不 reset 既有資料庫。另查 PostgreSQL catalog，沒有遺留 bootstrap_test_* 測試庫。

## 已處理問題與限制

首次在 Windows 掛載目錄安裝依賴過慢，改到獨立 Linux 檔案系統進行乾淨安裝。初選 ESLint 9 收到停止支援提示，改用 ESLint 10 與相容官方 plugin 組合（ADR 0001），舊安裝未作為成功結果。正式鎖檔與後續所有通過結果使用新版工具鏈。

本機驗證用 Docker 內部的 db:5432；一般開發者依 DEVELOPMENT.md 使用 localhost:55432。這些是同一個隔離的本機 PostgreSQL 服務，並非正式資料庫。

本 Issue 僅 M0：沒有正式登入、membership、角色、project CRUD、RLS、付款、LLM 或部署。兩租戶授權／非成員拒絕矩陣屬 M1，不能將此次 schema 完整性測試宣稱為租戶授權完成。README 與原六份規範文件均未覆寫。

PM 依 PR 驗收表審查；使用者決定合併。此變更不推送 main、不合併、不部署，不自動啟動後續里程碑。
