# Phase 1 驗證報告

日期：2026-10-26（Asia/Taipei）。範圍：平台身分、租戶、門店、RBAC、審計與同源管理 UI；五個業務模組維持預留。

## 驗證結果

| 項目 | 結果 |
|---|---|
| PostgreSQL 自動化測試 | 28/28 通過，約 3.7 秒 |
| Django check | 0 issues |
| migration drift | No changes detected |
| 開發資料庫 migration | 0001_initial、0002_database_guards 套用成功；migrate --check 通過 |
| 前端 fresh npm ci | Linux Docker 建置通過 |
| 前端 typecheck / production build | 通過，initial bundle 263.41 kB |
| npm audit | 0 vulnerabilities（執行時 registry 結果） |
| Docker build / up --wait | 通過，db/backend/frontend healthy |
| localhost:4200 首頁 | HTTP 200；瀏覽器確認平台登入頁版面 |
| backend live、前端代理 ready、CSRF API | HTTP 200；API 有 X-Request-ID |
| 未登入 /auth/me/ | HTTP 403 |
| GitHub Actions | workflow 已更新，尚未推送觸發 |

28 項包含原健康檢查 4 項與平台 24 項，涵蓋：匿名拒絕、跨租戶列表／物件／寫入拒絕、body tenant 注入無效、門店代碼唯一、逐店 scope、manager/viewer 禁止管理、superuser 無租戶繞過、停用身分／租戶、密碼 validation/hash、foreign store 指派拒絕、成員角色更新、最後管理員保護、審計 scope 與 transaction rollback、資料庫 bulk assignment／tenant reparent／audit update/delete guard、CSRF token 輪換與 session 登出、失敗登入審計與限流、request ID、互動式 provision_tenant、多租戶身分引用、並發降權、停用門店指派保留。

真實 HTTP 測試使用 Django LiveServerTestCase、cookie jar 與獨立測試資料庫，驗證取得 CSRF、無 CSRF 登入被拒、成功登入、建立／讀取門店、登出後 session 失效。HTTP 測試單獨 override secure cookie=False，因測試伺服器使用 HTTP；不修改正式 DEBUG=0 cookie 安全設定。

瀏覽器驗證止於實際登入頁的顯示，未將測試帳密寫入開發資料庫。開發資料庫使用者與租戶仍為 0；首次登入需由操作者執行 README 的 provision_tenant 互動式命令。測試用帳號與資料只在 test_sme_cloud 建立，測試後銷毀。未改動既有 Mini WMS 程式或遷移其資料。

## 修正與限制

第一輪本機前端編譯發現缺少 FormsModule 所需 @angular/forms，已新增依賴及鎖檔；後續 Linux 容器 npm ci/typecheck/build 通過。真實 HTTP 測試曾因 STATIC_URL 未設定而失敗，補上 /static/ 後通過。上述失敗不隱藏，也不計為成功結果。

保留 Django User，未清空 auth 表或切換 AUTH_USER_MODEL。新增 schema 可在 Phase 0 資料庫直接套用。資料庫 guard 為 PostgreSQL 專用，沒有 SQLite 替代路徑。

本機 Docker credential helper 仍使用獨立 .docker-local 設定避開；容器保留執行於 localhost:4200 / localhost:8000。此為開發環境，無正式 TLS、production server、共享限流、MFA／密碼重設／邀請流程、RLS 或 runtime DB 分權。完整限制見 docs/security/phase1-security.md。

UI 顯示最多 100 門店／成員、50 審計；API 支援 limit/offset 分頁。manager 與 viewer 的平台門店讀取權限相同，業務權限仍未定義。未增加任何 WMS、E-Commerce、CRM、HR 或 Restaurant 業務 models/API/畫面。

Phase 1 完成後停止；Phase 2 WMS 必須另行確認。

## 2026-10-29 Docker 重驗

依目前工作區原始碼重新建置隔離的 `sme-cloud-phase1-validate` Compose 專案驗證；沒有重建、停止或修改既有 `sme-cloud`／`multi-tenant-saas-bootstrap` 服務。為避開已使用中的 8000／4200 host ports，驗證專案未發布 host ports。驗證服務已停止；其專用 PostgreSQL volume 保留，原有 volume 未觸碰。

| 項目 | 結果 |
|---|---|
| `docker compose --env-file .env.example config --quiet` | 通過 |
| Backend / Frontend Docker image build | 通過；frontend `npm ci` 安裝 407 packages，npm audit 回報 0 vulnerabilities |
| `python manage.py check` | 通過，0 issues |
| `python manage.py makemigrations --check --dry-run` | 通過，No changes detected |
| PostgreSQL 17 migration | 通過；內建 auth/contenttypes/sessions 與 platform_core 兩個 migration 全部套用 |
| `python manage.py test` | 通過，28/28；測試資料庫建立並於結束後銷毀 |
| `npm run typecheck` | 通過 |
| `npm run build` | 通過；初始 bundle 263.41 kB |
| Angular 首頁及 `/api/v1/health/ready/` 同源 proxy | 兩者 HTTP 200，ready 回傳 `{"status":"ready"}` |

主機未安裝 Django 或 npm，因此本次檢查在剛建置的容器中執行。Docker Desktop 的 credential helper 在一般設定下無法啟動，依本機開發指南改用未登入公開 registry 的 `.docker-local` 設定；使用 `.env.example` 的假值及獨立 Compose 專案。沒有執行 `down -v`，也沒有修改 legacy Mini WMS、業務模組或既有資料。
