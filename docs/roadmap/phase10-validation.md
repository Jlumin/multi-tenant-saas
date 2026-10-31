# Phase 10 驗證紀錄

日期：2026-10-31

Phase 10 adds an optional per-listing category and a customer-side category filter over the Phase 8 opt-in public catalogue. Category values remain tenant-scoped through their parent listing; there is no independent public category endpoint.

## 驗收重點

- Listing category is optional, blank-compatible and limited to 80 characters.
- Public facet values come only from active, sellable listings belonging to the enabled tenant.
- Filtering preserves category options and returns only exact category matches.
- Existing opt-in, image visibility, stock-minimization and throttle protections remain in place.
- No customer/order mutation, email, checkout or payment flow is added.

## 驗證結果

驗證結果：

- Backend `manage.py check`: 通過，無系統問題。
- Backend `makemigrations --check --dry-run`: 通過，No changes detected。
- PostgreSQL `ecommerce.0003_listing_category`: 本機已套用。
- Backend `manage.py test modules.ecommerce`: 11 tests passed。
- Backend `manage.py test`: 81 tests passed。
- Frontend `npm run typecheck` 與 `npm run build`: 通過。
- Docker Compose config valid；本機 frontend/backend/DB health 正常，HTTP 前端與 readiness 回傳 200。

店面沒有真實 listing，因此未用虛構資料驗證分類篩選的視覺效果；API 分類清單與篩選由自動測試驗證。公開店面仍預設關閉。GitHub Actions 結果於推送後補記。
