# Phase 6：營運準備與上線門檻

Phase 6 建立可供部署前審查的基礎，不代表 SME Cloud 已部署、已公開或已通過正式環境驗收。開發環境仍使用根目錄 `compose.yaml`；production overlay 以 Gunicorn 和 Angular 靜態資產 Nginx 取代開發伺服器，入口只綁定 `127.0.0.1:8080`，必須由可信 TLS edge proxy 轉送。資料庫與 Django 不發布主機 port。

## 本機備份與隔離還原演練

先確認目前 Compose project 指向預期的本機開發資料庫。此工具不會停止服務、刪除 volume 或覆寫原資料庫；restore drill 只建立帶有受限前綴的暫存 database，完成後只刪除該暫存 database。

```powershell
./tools/postgres-backup.ps1 -Action backup
$archive = Get-ChildItem .backups/*.dump | Sort-Object LastWriteTime -Descending | Select-Object -First 1
./tools/postgres-backup.ps1 -Action restore-drill -BackupPath $archive.FullName
```

備份以 PostgreSQL custom archive 格式產生，並另存 SHA-256 sidecar；restore 前會比對雜湊，還原後確認 `django_migrations` 可讀且有 migration 記錄。這是同一個本機 PostgreSQL container 內的隔離 database 練習，不是正式環境的災難復原演練，也不能證明 offsite copy 可用。備份包含個資且未加密；`.backups/` 已加入 Git ignore。正式環境需加密、異地複製、限制存取，並在獨立非正式環境還原。

部署工作目錄使用部署專用且權限受限的 env 檔，由 secret manager 注入實際秘密；`config/production.env.example` 只含待替換範本值，不可直接部署。production overlay 會要求明確的 hostname、HTTPS origin 與 HSTS 秒數：

```powershell
$envFile = "C:\secure\sme-cloud-production.env"
docker compose --env-file $envFile -f compose.yaml -f compose.production.yaml config --quiet
docker compose --env-file $envFile -f compose.yaml -f compose.production.yaml up -d --build --wait
docker compose --env-file $envFile -f compose.yaml -f compose.production.yaml exec -T backend python manage.py migrate --noinput
docker compose --env-file $envFile -f compose.yaml -f compose.production.yaml exec -T backend python manage.py migrate --check
```

先備份並確認上一個版本可回復，再在維護窗口執行 migration。不要把 migration 自動放進 web container 啟動命令。正式還原演練應在隔離的 PostgreSQL instance 完成，而非 production instance。

## Production 入口與安全設定

先以 TLS edge proxy 提供 HTTPS，再把流量轉至本機 Nginx `127.0.0.1:8080`。edge proxy 必須自行覆寫 `X-Forwarded-Proto: https`，不可透傳外部使用者提供的同名 header；應只允許此 proxy host 連到 Nginx。Nginx 再將該值送給 Django。若此信任鏈未落實，不得設定 `DJANGO_TRUST_PROXY_SSL=1`。TLS edge 需對 UI 靜態回應及 API 都送出 HSTS；Django 的 HSTS middleware 只處理 API 回應。

部署 `.env` 至少提供：

```dotenv
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=<secret-manager 提供的隨機秘密>
DJANGO_ALLOWED_HOSTS=app.example.com
FRONTEND_ORIGIN=https://app.example.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://app.example.com
DJANGO_SECURE_SSL_REDIRECT=1
DJANGO_SECURE_HSTS_SECONDS=31536000
DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=0
DJANGO_SECURE_HSTS_PRELOAD=0
```

只有在 TLS proxy 已驗證且是唯一 ingress 後，production overlay 才會啟用 proxy SSL 判斷。先驗證所有子網域均持續使用 HTTPS，才考慮 HSTS `includeSubDomains` 或 preload。不要將 `.env`、真實 secret、備份或帶個資的日誌加入 Git。

## 健康、日誌與效能

- `/api/v1/health/live/` 表示 Django process 可回應；`/api/v1/health/ready/` 額外檢查 PostgreSQL。Nginx `/healthz` 僅檢查前端入口。健康狀態不代表 migration、外部 TLS 或邀請信已驗證。
- Compose healthcheck 為部署編排提供訊號。正式監控還需由外部監控定期探測公開 HTTPS health URL，對 ready/HTTP 5xx、資料庫連線、磁碟、容器重啟及備份新鮮度設告警；告警接收管道尚待決定。
- Django request ID middleware 可在請求中關聯追蹤 ID；服務輸出送至容器 stdout/stderr。production 關閉 Gunicorn access log，避免 URL 中的 QR token 被一般 access log 記錄。平台仍需確認日誌集中化、保存期限、遮罩政策與輪替容量。
- 尚未有正式流量分布、SLO 或硬體規格，因此沒有宣稱通過負載／效能門檻。上線前需依預期併發、資料量及 API 熱點定出 p95 延遲、錯誤率與容量目標，再於 staging 執行基準和壓力測試。

可用 `./tools/measure-health.ps1 -Requests 50` 對本機 UI 與 ready endpoint 記錄 min/p50/p95/max。它是單請求順序的開發機 smoke baseline，不是並發壓測或正式 SLO 驗收；正式環境使用前需指定 HTTPS URL 並先定效能目標。

## 回滾與 schema 變更

1. 發布前記錄目前 image/revision，建立備份並驗證 checksum；確認能取得上一版映像。
2. 採 expand → backfill → switch → contract，將具破壞性的 schema 收尾延後至相容版本已穩定後。
3. 若應用程式回歸，先回復上一個 image。不要假設舊版可以使用已刪除／改名的 schema；不要在部署腳本自動執行 reverse migration。
4. 若資料已被錯誤轉換或 schema 不相容，停止寫入並由維運負責人判斷是否在隔離環境演練後，以備份還原整個資料庫。回復到備份時間點會遺失其後寫入，需明確停機並通知使用者。
5. 還原完成後驗證 migration、租戶隔離與關鍵交易，再恢復服務。回滾責任人、RPO/RTO、維護窗口及通知方式待正式營運決策。

## 尚未完成的正式上線工作

production CI 已加入 pip-audit/npm audit 依賴掃描、Gitleaks Git 歷史秘密掃描，Docker base images 固定 digest，並由 Dependabot 每週檢查依賴/映像更新。這些 CI gate 需等變更推送至 GitHub 才能驗證遠端 runner 結果。production 設定尚未在專用 staging/prod 主機跑過；沒有域名、TLS provider、secret manager、異地備份目的地、監控接收端或容量指標。不得將本文件視為部署核准或運行手冊的最終版本。
