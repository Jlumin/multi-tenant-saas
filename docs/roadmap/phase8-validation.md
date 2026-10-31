# Phase 8 驗證紀錄

日期：2026-10-31

## 已完成

- 後台租戶管理員可選擇啟用／停用客戶店面；資料庫預設關閉，既有租戶不會因 migration 而公開。
- `/shop/{tenant_slug}/` 提供租戶品牌、Logo、上架商品、價格、商品圖片與有貨／缺貨狀態；支援搜尋、分頁載入及僅存在瀏覽器記憶體的購物清單。
- 公開 API 只讀，不建立訂單、不預留庫存、不收集客戶資料；結帳介面標示尚未開放。
- 專項測試涵蓋未啟用 404、啟用後目錄與公開圖片、跨租戶圖片拒絕、下架／停用後不公開、搜尋、不回傳精確庫存與客戶欄位，以及超過 60 次／分鐘後回傳 429。

## 本機驗證

| 檢查 | 結果 |
|---|---|
| `python manage.py check` | 通過，無系統問題 |
| `python manage.py makemigrations --check --dry-run` | 通過，No changes detected |
| `python manage.py test modules.ecommerce` | 通過，10 tests |
| `python manage.py test` | 通過，80 tests |
| `npm run typecheck` | 通過 |
| `npm run build` | 通過，Angular production build 完成 |
| Docker Compose dev services | backend、PostgreSQL、frontend 均 healthy |

目前開發資料庫尚無商品與 E-Commerce 上架，因此新店面尚無商品卡片可供人工驗證。啟用店面並建立有效 WMS 商品／庫存與 E-Commerce listing 後，即可由後台連結開啟客戶頁面；不在此驗證中建立虛構客戶商品。

## 保留的人工確認／上線前工作

- 管理員自行啟用店面並檢查真實 Logo、品牌色、商品圖、價格、缺貨狀態及手機版顯示。
- 確認正式環境 trusted proxy 的 client IP 設定、跨副本共享限流／快取與 CDN 快取失效行為。
- 公開結帳仍待獨立確認會員或訪客流程、收件／配送、付款、通知、退款與退貨政策；本階段不得對外收單。

未執行正式環境部署或 production 資料操作。
