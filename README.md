# SME Cloud — Phase 8 Customer Storefront

Angular + TypeScript、Django + DRF、PostgreSQL、Docker Compose、GitHub Actions 的 Modular Monolith Monorepo。Phase 1 提供平台登入、租戶成員、逐店授權、角色與審計管理；Phase 2 加入 WMS 商品、包裝、倉庫、儲位、一般入出庫及庫存流水；Phase 3 加入 CRM 會員／同意紀錄與登入限定的 E-Commerce 上架、訂單、庫存預留和 sandbox 付款；Phase 4 加入 HR 員工排班與出勤；Phase 5 加入 Restaurant 共用菜單、QR 點餐與現金 POS；Phase 7 加入租戶品牌與圖片；Phase 8 加入可由租戶管理員選擇啟用的公開客戶商品型錄、庫存狀態和購物清單。公開 E-Commerce 結帳、客戶登入與真實金流尚未開放；Restaurant QR 是限桌號 token 的公開 API 例外，目前只收現金、不串 WMS。舊版 Mini WMS 是另一套獨立程式，不屬於此 SME Cloud repository，也沒有進行程式整合或資料遷移。

## 目錄

- apps/frontend：Angular 21 / TypeScript 5.9 平台管理 UI
- apps/backend：Django 5.2 LTS / DRF，platform_core 與 modules/{wms,ecommerce,crm,hr,restaurant}
- Phase 2 WMS 詳見 [操作與 API](docs/architecture/wms-phase2.md)、[schema](docs/database/wms-phase2.md)、[安全規則](docs/security/wms-phase2.md)
- Phase 3 CRM／E-Commerce 詳見 [架構與 API](docs/architecture/crm-ecommerce-phase3.md)、[schema](docs/database/crm-ecommerce-phase3.md)、[安全規則](docs/security/crm-ecommerce-phase3.md)、[驗證結果](docs/roadmap/phase3-validation.md)
- Phase 4 HR 詳見 [架構與 API](docs/architecture/hr-phase4.md)、[schema](docs/database/hr-phase4.md)、[安全規則](docs/security/hr-phase4.md)、[驗證結果](docs/roadmap/phase4-validation.md)
- Phase 5 Restaurant 詳見 [架構與 API](docs/architecture/restaurant-phase5.md)、[schema](docs/database/restaurant-phase5.md)、[安全規則](docs/security/restaurant-phase5.md)、[驗證結果](docs/roadmap/phase5-validation.md)
- docs/architecture、docs/database、docs/security、docs/roadmap：架構及五模組規劃
- .github/workflows/ci.yml：後端、前端、依賴／秘密掃描及 Compose 檢查；Dependabot 每週檢查更新
- [Phase 6 營運準備](docs/operations/phase6.md)：備份/還原、production 設定、監控與回滾
- [Phase 7 品牌與圖片管理](docs/architecture/tenant-branding-phase7.md)：租戶專屬品牌外觀、Logo 與 WMS 商品圖
- [Phase 8 客戶店面](docs/architecture/ecommerce-storefront-phase8.md)：公開商品瀏覽、品牌套用、庫存有／無提示與購物清單；結帳保留待後續設計
- [Phase 8 驗證紀錄](docs/roadmap/phase8-validation.md)：自動測試結果與未完成的正式環境前置條件
- [Phase 9 驗證紀錄](docs/roadmap/phase9-validation.md)：店面文案客製化與商品詳情顯示
- [Phase 9 資料庫欄位](docs/database/storefront-content-phase9.md)：每租戶店面標題與介紹

## Docker 開發環境

需要 Docker Engine 與 Compose v2。於根目錄執行：

```powershell
Copy-Item .env.example .env
# 編輯 .env 更換本機密碼與 secret；勿提交
 docker compose config --quiet
 docker compose up --build --wait
 docker compose exec backend python manage.py migrate --noinput
```

首頁 http://localhost:4200；登入後由租戶管理員在「品牌外觀與客戶店面」啟用公開店面，即可開啟 `/shop/{租戶 slug}/`。WMS 圖片需先建立商品、入庫，再於 E-Commerce 建立上架，店面才會顯示可購買商品。API http://localhost:8000/api/v1/health/live/；資料庫就緒檢查 /api/v1/health/ready/。前端 /api 轉發至 backend。ready 只檢查連線，不代表 migration 已套用。開發伺服器只綁定本機，程式修改後重新 build。停止使用 `docker compose down`，保留資料 volume。這不是正式部署配置。

若 Windows 出現 `docker-credential-desktop` 無法執行，可對本專案公開映像使用獨立的本機設定：將上述命令的 `docker compose` 改為 `docker --config .docker-local compose`。`.docker-local/` 已忽略，不修改系統 Docker 設定；私有 registry 仍需另行設定登入。

## 本機驗證

Node 24（含 npm）、Python 3.13、可連線 PostgreSQL 17。後端需環境變數 DJANGO_SECRET_KEY、POSTGRES_DB、POSTGRES_USER、POSTGRES_PASSWORD，並設定 POSTGRES_HOST/PORT；本機執行不會自動讀取 .env。若需透過 Compose DB 供本機連線，另行設定僅 localhost 的 port mapping。

```powershell
python -m venv .phase0-venv
./.phase0-venv/Scripts/Activate.ps1
pip install -r apps/backend/requirements.txt
cd apps/backend
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test
python manage.py migrate --noinput
cd ../frontend
npm ci
npm run typecheck
npm run build
```

本機 `npm start` 的預設 proxy 適用 Compose；獨立執行時將 proxy target 改為 http://localhost:8000。CI 使用 PostgreSQL service 檢查 migration 與真實 readiness，另建置 Compose 做同源 HTTP smoke test。GitHub Actions 會在分支推送及 Pull Request 建立後執行；production overlay 只供部署前檢查與操作規劃，本機驗證不代表已核准上線。

## 建立第一個租戶與登入帳號

先套用 migration，再由可信維運人員在互動式終端執行（此命令不可加 `-T`）：

```powershell
docker --config .docker-local compose --env-file .env.example exec backend python manage.py provision_tenant --name "我的公司" --slug my-company --username my-admin
```

新帳號會互動詢問並確認密碼（至少 12 字元，不能使用常見／全數字／近似帳號密碼）。不提供預設帳密、不透過 command argument/env 傳入密碼。若 username 已存在且啟用，只新增新租戶成員資格，不更改既有密碼。完成後至 http://localhost:4200 登入；租戶管理員可建門店、建新帳號及指派角色／門店。其他角色未指派門店前無門店存取權。沒有公開註冊、密碼重設或邀請信；WMS、CRM、E-Commerce 與 HR 內部流程已有畫面，Restaurant 維持空骨架。

詳見 [Phase 1 架構與 API](docs/architecture/phase1-platform.md)、[schema](docs/database/phase1-schema.md)、[安全狀態](docs/security/phase1-security.md)、[路線圖](docs/roadmap/README.md)、[Phase 1 驗證](docs/roadmap/phase1-validation.md)、[Phase 2 WMS 驗證](docs/roadmap/phase2-wms-validation.md)、[Phase 3 CRM／E-Commerce 驗證](docs/roadmap/phase3-validation.md)、[Phase 4 HR 驗證](docs/roadmap/phase4-validation.md)、[Phase 5 Restaurant 驗證](docs/roadmap/phase5-validation.md) 與 [Phase 6 營運準備](docs/roadmap/phase6-validation.md)。[Phase 0 報告](docs/roadmap/phase0-validation.md) 保留為歷程。

