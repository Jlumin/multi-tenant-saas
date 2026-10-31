# Phase 0 驗證報告

最新狀態：Docker 實機整合驗證已通過。下方保留初次驗證限制及診斷歷程；目前結果以文末「Docker 驗證完成」為準。

日期：2026-10-26（Asia/Taipei）。

| 項目 | 結果 |
|---|---|
| Django system check | 通過，0 issues |
| Django tests | 4/4 通過：public liveness、readiness 成功／失敗、五模組路由未開放 |
| TypeScript strict typecheck | 通過 |
| Angular production build | 通過；initial bundle 187.36 kB |
| Compose config | 通過 |
| PostgreSQL migration / 真實 readiness / 容器 HTTP smoke | 續作已通過，詳見下方最新結果 |
| GitHub Actions | workflow 已建立，尚未推送觸發 |
| 原 Mini WMS pytest | 未執行；目前可用 Python 沒有 pytest，未改動原業務程式 |

本機使用 bundled Python 3.12（Django 5.2 支援）、Node 24.22.1；Compose/CI 指定 Python 3.13。解析套件為 Django 5.2.18、DRF 3.16.1、psycopg 3.2.13；前端完整解析見 package-lock.json。安裝及 Angular build 曾受沙箱網路／父目錄讀取限制，經授權重試成功。npm 執行 install-script 提示，未影響本機 build；Linux 容器原生依賴仍需 CI 實測。

本機 makemigrations 檢查無 PostgreSQL 可用，不能作為 migration 整合通過證據。CI 已配置真實 PostgreSQL、migrate、readiness 及 Compose build/HTTP 檢查。Phase 0 交付物已建立，端到端容器驗證仍受環境限制；不宣稱可正式上線。

五個業務模組只有空 Python package / README 與前端 README，無業務 models、migrations、API 或頁面。完成此交付後停止，等待使用者確認。

補充：makemigrations --check --dry-run 回傳 No changes detected（exit 0），但同時警告資料庫連線 timeout，尚未驗證 migration history。最後重跑 Django check 與 4 項測試皆通過。

## Docker 實機驗證續作（2026-10-26）

已嘗試啟動 Docker Desktop 4.29.0。Desktop 程序啟動，但 backend 記錄 ExitBadState：無法移除 `AppData/Local/Docker/run/userAnalyticsOtlpHttp.sock`（The file cannot be accessed by the system）。預設 Engine 與 dockerDesktopLinuxEngine named pipe 均不存在；WSL 預設版本為 2。

已停止 Desktop 並嘗試將該 socket 改名備份；作業系統仍拒絕存取，改名未成功。隨後重新啟動 Desktop。未刪除容器、映像、volume 或重設 Docker。需先在主機使用者環境修復 Desktop 啟動問題，才能執行容器建置與資料庫整合測試。

修正兩個 app 的 build context：新增各自 `.dockerignore`，排除 host node_modules、dist、Angular cache 及 Python cache，避免 Windows 套件覆蓋 Linux 依賴。根目錄 `.dockerignore` 不會套用至這兩個子目錄 build context。

Compose CI 增加容器內 check、migration drift、migrate、後端測試、前端 typecheck/build。這些是待執行的檢查，不是實機通過結果。

## Docker 驗證完成（2026-10-26）

Engine 26.0.0 已可連線。預設 Docker credential helper 執行失敗，使用 `docker --config .docker-local compose --env-file .env.example ...` 拉取公開映像並完成驗證；未修改全域 Docker 設定。

| 實機項目 | 結果 |
|---|---|
| Compose config、前後端 Docker build、up --wait | 通過 |
| PostgreSQL、backend、frontend healthcheck | 三者 healthy |
| 容器內 Django check | 0 issues |
| makemigrations --check --dry-run | No changes detected，真實 PostgreSQL 可連線 |
| migrate --noinput、migrate --check | Django 內建 migrations 套用成功，無待套用項目 |
| 容器內 Django tests | 4/4 通過 |
| 容器內 npm ci、typecheck、production build | 通過；initial bundle 187.36 kB |
| 首頁 localhost:4200 | HTTP 200，包含 app-root |
| backend live / ready | HTTP 200，status ok / ready |
| frontend /api/v1/health/ready/ 同源代理 | HTTP 200，status ready |
| npm audit（修補後） | 0 vulnerabilities |

首次容器安裝發現 Angular build 的 undici 7.29.1 依賴有已知弱點。加入針對 `@angular/build` 的 undici 7.30.1 override 並更新鎖檔，未升級 Angular 主版或改動其他 undici 主版使用者。全新 npm ci、映像重建、typecheck、build、audit 與 HTTP smoke 均已重驗。override 待 Angular 上游依賴更新後再評估移除。

新增 frontend HTTP healthcheck，使 Compose --wait 等待實際首頁可用。容器保留執行，僅 localhost 開放 4200/8000；PostgreSQL 沒有 host port。使用 .env.example 的資料僅作本機開發驗證，未放入真實客戶資料。停止可用 `docker --config .docker-local compose --env-file .env.example down`，不要使用 -v 以保留資料。

GitHub Actions 仍未推送觸發，本次為本機 Docker 實測。Phase 0 已完成並停止，未實作任何業務模組。
