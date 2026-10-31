# Phase 4 HR 驗證結果

驗證環境：Docker Compose 專用專案 `sme-cloud-phase4-validate`、獨立 PostgreSQL volume；不修改使用者既有 `sme-cloud` 開發資料庫。驗證日期：2026-10-30。

| 檢查 | 結果 |
|---|---|
| Compose config | 通過 |
| PostgreSQL 全部 migrations（含 `hr.0001_initial`、`hr.0002_database_guards`） | 通過 |
| `python manage.py check` | 通過，無問題 |
| `python manage.py makemigrations --check --dry-run` | 通過，無未產生 migration |
| HR 專項 Django tests | 7/7 通過 |
| 完整 Django tests（含真實 HTTP session/CSRF 與 HR 打卡流程） | 通過，63/63 |
| `npm run typecheck` | 通過 |
| `npm run build` | 通過；初始 chunk 約 340.45 kB |
| Compose HTTP readiness smoke | 通過：隔離環境及本機 `localhost:4200` 前端、`localhost:8000/api/v1/health/ready/` 均回傳 HTTP 200；目前前端 bundle 含 Phase 4 HR dashboard |

HR 專項測試覆蓋管理員建立員工／班別／排班、跨日與重疊排班、員工自助打卡與冪等、跨租戶拒絕、不可替他人打卡、補登雙人核准、viewer 隱私及 DB append-only guards、錯誤時區與未連結帳號拒絕。真實 HTTP 測試亦驗證登入後 HR 寫入必須提供有效 CSRF token。

尚未涵蓋：人工瀏覽器端到端流程、DST 特殊時間政策、通知寄送及最終 HR 規則（休息／遲到／加班／保存年限）。本機 Compose 已更新至 Phase 4 並保留既有 DB volume；遷移前確認租戶 1、使用者 1、WMS 商品 0、庫存餘額 0，僅套用 HR 新增 migration。Phase 4 完成後停止；Phase 5 Restaurant 需另行核准。
