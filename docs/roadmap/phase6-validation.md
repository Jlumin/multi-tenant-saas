# Phase 6 營運準備記錄

日期：2026-10-30。使用者核准進入 Phase 6。

## 已完成

- 加入 production Compose overlay：Django 以 Gunicorn 執行、Angular 編譯為靜態資產由 Nginx 服務；web/database 不向外發布，Nginx 僅綁定本機 loopback，預期前方另有 TLS edge proxy。
- Django HTTPS redirect、HSTS、CSRF trusted origins 與可信代理 SSL header 可由環境設定。proxy header 只在明確啟用時受信任；正式設定和信任條件已寫入營運文件。
- 加入 PostgreSQL custom-format 備份和 checksum 驗證腳本；restore drill 還原至隔離的暫存 database，檢查 Django migration table，再清除限定前綴的暫存 database。
- 補上健康檢查、日誌與效能量測說明、備份/回滾程序，以及上線前決策清單。
- 依賴掃描找到 Django REST Framework 3.16.1 的 5 項已知弱點，已升級最低版本至 3.18.3；production image 以 digest 固定 Python、Node、Nginx 與 PostgreSQL。CI 加入 pip-audit、npm audit、Gitleaks 歷史掃描，Dependabot 每週檢查更新。
- 新增 `tools/measure-health.ps1`，提供本機 UI/ready endpoint 順序量測 min/p50/p95/max；它不作為負載壓測或正式 SLO 門檻。

## 驗證狀態

- 開發 Compose 與 production overlay `config --quiet`：通過；production resolved config 確認 DB/backend 無 host port，Nginx 僅 `127.0.0.1:8080`。
- Django `check`：通過（0 issues）；`makemigrations --check --dry-run`：無新 migration。第一次在現有本機資料庫歷史一致性查詢 timeout，但 schema diff 結果為 `No changes detected`；後續在臨時 PostgreSQL 上重跑通過。
- Django `check --deploy`：命令通過，報 2 個刻意保留的提醒：HSTS includeSubDomains 與 preload 未開啟。只有確認所有子網域全程 HTTPS 後才可開啟，故不把提醒當作自動套用建議。
- Django 測試套件：升級 DRF 3.18.3 後，在臨時、無持久 volume 的 digest-pinned PostgreSQL 17 容器中 70/70 通過；測試 DB 在完成後銷毀。
- Dependency scan：第一次 pip-audit 發現 DRF 3.16.1 5 項已知弱點（上游 3.18.2 起含安全修補）；升至 3.18.3 後 pip-audit 回報無已知弱點。前端 clean npm audit 在前次 production build 回報 0 vulnerabilities，且已納入 CI gate。
- Frontend：本機已存在的 `node_modules` 缺少 `@angular/forms`，直接 typecheck 未通過；改以 production Docker build 執行乾淨 `npm ci`、`npm run typecheck` 和 `npm run build`，三者通過。npm audit 在該次 clean install 回報 0 vulnerabilities。
- Digest-pinned production image build 通過。獨立 smoke project 的 DB/backend/frontend healthcheck 通過；經 Nginx 取得 UI、`/api/v1/health/live/` 與 `/api/v1/health/ready/` 均為 HTTP 200。未帶 forwarded HTTPS header 時 API 回 301，帶可信 header 回 200。測試只模擬 TLS edge，未建立真實 TLS proxy。
- 使用獨立 smoke project 的空白資料庫套用 migrations，透過備份腳本建立 checksum 並在暫存 database 還原；28 筆 migration records 驗證通過。測試用 Compose volume 已移除；合成 schema dump 留在 Git 忽略的 `.backups/` 供檢視，沒有使用正式資料或個資。正式資料庫與 volume 未改動。
- 正式環境測試、真實 TLS edge proxy 與 offsite 備份還原未執行，因為目前沒有部署主機／網域／外部備份目標；本機 50 request 順序測量：UI p50 2.6ms/p95 4.6ms，DB-ready p50 8.8ms/p95 12.7ms。這只反映本機 Docker 開發環境，不能推定為正式負載門檻通過。

## 上線前待決

- 正式網域與 TLS termination/proxy provider，及 proxy 對 `X-Forwarded-Proto` 的覆寫與 ingress 限制。
- Secret manager、PostgreSQL 備份加密與 offsite 目的地；RPO/RTO 和保存週期。
- 監控/告警接收管道、日誌保存期限與個資遮罩規則。
- 預期併發、資料量、p95 latency/SLO 與負載測試環境。
- GitHub Actions 上的掃描 runner 結果；目前只有本機依賴掃描，無法在此本地工作目錄驗證 Git 歷史掃描。
- HR / CRM / Restaurant 個資保存、稅費與作業政策，管理員邀請寄信（依使用者指示留待全部模組建置後人工驗證）。
