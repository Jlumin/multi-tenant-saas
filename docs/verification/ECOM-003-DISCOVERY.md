# ECOM-003 Discovery 驗證

對應 GitHub Issue #28。這是需求與架構探索文件，不新增 API、model、migration、UI 或庫存寫入。

## 對照現況

- ECOM-001/002 來源：`EcomProduct` 只有 E-Commerce 代碼／售價；Guest checkout 建立固定 `submitted` 訂單，快照不可變，不查 WMS。
- WMS 來源：`WmsProduct`、`WmsStockBalance` 與 `WmsStockMovement` 由 WMS 擁有；現有 `balances` 需 `Actor` 與 active membership；目前無 reservations。
- 架構邊界：兩模組不直接寫對方資料表；需要服務端同租戶商品 reference 與 WMS-owned public service。
- 文件列出 WMS reservation/release/fulfill 候選責任與錯誤分類，並覆蓋 Owner／Member／匿名、跨租戶、分店與倉庫、併發不足、冪等重播、失敗補償、釋回、停用及歷史快照情境。
- 下一張 implementation Issue 目前只有草案；它列出實作前需確認的產品決策，沒有把候選政策標成已核定。

## 已記錄的風險／缺口

- 將 balance quantity 當可售量無法處理併發出庫或同時下單。
- 現有訂單沒有取消、付款、到期或履約狀態；reservation 缺少可靠的釋回觸發條件會永久占量。
- E-Commerce 未選供貨倉；將多倉量直接加總可能導致無法履約或錯誤承諾。
- 此 Issue 將上述內容分類為待產品決策，先不替使用者設定正式交易政策。

## 驗證方式

- 文件交叉比對 `src/server/ecommerce/orders.ts`、`src/server/wms/stock-service.ts`、`prisma/schema.prisma`、WMS ADR 0006 與 E-Commerce/WMS requirements。
- `git diff --check` 與提交前 `git diff --cached --check`：通過，無 whitespace errors。
- 文件-only 變更沒有額外執行本機應用測試；Draft PR #29 的 GitHub Actions run `40560044105`（head `e471df76b16e94801ae90231e7d03822d7051bf5`）全套成功：lint、typecheck、unit、DB validate/smoke、PostgreSQL integration、dev HTTP smoke、build、production HTTP smoke、auth HTTP smoke。
- CI 僅有一筆非阻擋 notice：`ubuntu-latest` 將於 2026-10-19 起遷移 Ubuntu 26；沒有失敗 annotation。
