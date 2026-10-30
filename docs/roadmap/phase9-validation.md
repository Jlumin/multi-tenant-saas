# Phase 9 驗證紀錄

日期：2026-10-31

Phase 9 extends the customer-facing storefront presentation only. Tenant admins can set per-storefront heading and description; visitors can open a product detail dialog using only fields already published by the Phase 8 catalogue.

## Scope limits

- Public catalog remains opt-in and read-only.
- Product details show image, product code, title, advertised price and boolean availability only.
- The cart remains in-browser only; no guest/member identity, checkout, order API, notifications or payment is added.
- Blank copy uses generic fallback text. Input bounds are 120 characters for heading and 240 for description.

## Validation

## 驗證結果

- Backend `manage.py check`: 通過，無系統問題。
- Backend `makemigrations --check --dry-run`: 通過，No changes detected。
- PostgreSQL `platform_core.0005_storefront_content`: 本機已套用。
- Backend `manage.py test`: 80 tests passed；E-Commerce 與 platform_core 專項 43 tests passed。
- Frontend `npm run typecheck`、`npm run build`: 通過。
- Docker Compose config 與 backend／PostgreSQL／frontend 健康檢查：通過；本機 readiness 200。

未用真實商品做顧客端人工檢視，因本機租戶沒有上架商品，且公開店面維持關閉。公開結帳、客戶資料收集、寄信、金流與配送仍保留待後續確認。
