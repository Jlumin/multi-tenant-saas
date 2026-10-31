# Phase 2 WMS 驗證報告

日期：2026-10-29（Asia/Taipei）。範圍：WMS 商品／整數包裝、倉庫／儲位、入庫／出庫草稿、admin-only 過帳、庫存餘額與 append-only movement；其他業務模組維持 placeholder。

## 驗證結果

| 項目 | 結果 |
|---|---|
| Docker Compose config | 通過；使用 `.env.example` 假值 |
| Backend / Frontend Docker image build | 通過；Angular image 依 lockfile 安裝依賴 |
| PostgreSQL 17 全新 migration | 通過；Phase 0/1 migration 與 `wms.0001_initial`、`wms.0002_database_guards` 套用成功 |
| `python manage.py check` | 通過，0 issues |
| `python manage.py makemigrations --check --dry-run` | 通過，No changes detected |
| `python manage.py test` | 通過，42/42；含 14 個 WMS PostgreSQL 測試與 Phase 1 測試 |
| `npm run typecheck` | 通過 |
| `npm run build` | 通過；Angular initial bundle 296.01 kB |
| Compose readiness | PostgreSQL/backend/frontend healthy |
| HTTP smoke | Angular 首頁 HTTP 200；同源 `/api/v1/health/ready/` HTTP 200，回傳 `{"status":"ready"}` |
| 真實 session／CSRF HTTP 流程 | Django LiveServer cookie jar 驗證：取得 CSRF、登入、WMS 建商品／倉庫／一般入庫草稿、CSRF 過帳、讀取庫存，再登出拒絕；通過 |

14 個 WMS 測試涵蓋商品基本單位、角色與 tenant scope、倉庫預設未分配儲位、整數包裝換算及跨租戶單位拒絕、base unit 防停用、manager 草稿／admin 過帳、入出庫與負庫存拒絕、冪等及 key 衝突、audit rollback、過帳單據與 movement 資料庫不可改寫、餘額與異動查詢，以及兩筆競爭出庫不超賣。競爭測試使用 PostgreSQL `TransactionTestCase`。

隔離驗證使用獨立 Compose project `sme-cloud-phase2-validate`、本機假密碼與獨立 volume，未使用既有 `sme-cloud` 資料庫或正式秘密。前端沒有專用瀏覽器自動化；HTTP session 流程通過，但真人瀏覽器點擊驗收尚未執行。主機未安裝 npm/Django，檢查都在本次 Docker images 內完成。Docker Desktop credential helper 問題依開發指南使用 `.docker-local` 隔離設定處理。此為本機功能驗證，不是安全審查、正式資料遷移或部署驗收。

## 本機試用環境

隔離驗證後，已重建既有 `sme-cloud` 開發環境的 backend/frontend 容器，保留原 PostgreSQL volume，並在套用 WMS migration 前確認該開發資料庫有 0 位使用者及 0 個租戶。現在資料庫已建立租戶 `dev-test-company`（開發測試公司）與本機管理員帳號 `wms-demo`，供瀏覽器手動驗收；密碼只在本次對話提供，不存入文件或 Git。`sme-cloud` 三個服務目前皆 healthy，`http://localhost:4200/` 與同源 readiness endpoint 均回 HTTP 200。其他 Compose 專案未變更。試用租戶尚未建立 WMS 商品或倉庫。

## 尚待產品最後確認

- 本版將平台 `admin` 對應租戶 Owner；`manager` 可管理草稿、`viewer` 唯讀。這讓既有平台 RBAC 可先沿用，仍需試用確認是否符合倉管與盤點人員權限。
- WMS 倉庫與商品目前直接以 tenant 為 scope，尚未綁定 platform Store；需確認多門店租戶是否要限制倉庫可見範圍。
- 期初庫存、調撥、儲位移轉、盤點、沖銷及更正未納入本切片；沿用「期初另階段」決定，後續需分別規劃。
- 手動瀏覽器流程、租戶現場命名／SKU、包裝比例、資料保存政策與正式 DB runtime role 尚待最後整體驗收。

