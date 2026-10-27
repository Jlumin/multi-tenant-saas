# ECOM-002 驗證紀錄

對應 GitHub Issue #26。狀態：本機實作與完整自動驗證通過；Draft PR／GitHub Actions 尚待建立。只適用本機與測試環境，訂單買家姓名／email 保存期限尚未核定。

## 實作範圍

- 公開 `/shop/{slug}` 商品清單支援 browser localStorage 購物車、數量調整、移除及訪客結帳。
- `POST /api/shop/{slug}/checkout` 驗證來源、JSON、欄位、1–99 整數數量、高熵冪等鍵；拒絕客戶端價格／總額／tenant 欄位。
- server 以 slug 定位店面，在租戶列鎖交易中重查啟用狀態、上架商品及最新價格，Decimal 計算總額，寫入不可變訂單／商品快照及匿名 metadata audit。
- Owner-only `/api/ecommerce/{tenantId}/orders` 與 `/orders/{id}` 及 `/ecommerce/orders` UI；Member、匿名、跨租戶拒絕。
- 僅公開回傳訂單確認所需的狀態、編號、幣別、總額與商品快照，不回傳 tenant/store ID 或買家聯絡資料。

## PostgreSQL integration 案例

- 重算 server 價格；匿名 response 不含買家 email、tenantId、storeId。
- 同 key／同 payload 重送一筆訂單；同 key／異 payload 回 409。
- 拒絕草稿、未知、跨店商品、重複商品 ID、數量 0／100／小數／字串、來源跨站與客戶端 price／tenant 欄位。
- 商品下架與結帳競態：同租戶列鎖確保下架先提交時結帳拒絕。
- Owner 可讀自己的訂單；Member 得 403、非成員／其他租戶得 404；Owner 明細含買家聯絡資料。
- 商品改價／改名後既有訂單快照不變；資料庫拒絕修改訂單與明細。
- audit 只含 actor／action／target/request metadata，不含買家 PII；audit 寫入失敗時訂單交易 rollback。

## 產品確認清單（最後一起確認）

1. ECOM-001 暫定一租戶一間店、slug 固定及全域唯一。
2. 訪客結帳只收姓名與 email；不建立買家帳號、不寄通知。
3. 訂單固定 `submitted`、Owner-only 查看；Member 無訂單權限。
4. 價格／幣別／商品型態及不含稅、運費、折扣、支付與 WMS 庫存的範圍。
5. 買家姓名與 email 的保存期限、刪除／匯出與正式試用政策。此決定是正式營運前的必要條件。

## 驗證結果

2026-10-28 本機結果：

- `npm run lint`：通過，零警告。
- `npm run typecheck`：通過。
- `npm test`：通過，3 檔 10 項。
- `npm run test:auth`：通過，6 檔 76 項 PostgreSQL integration，包含下架競態。
- `npm run db:validate`：通過。
- `npm run db:smoke`：通過，13 份 migrations 全新部署、重複部署不變、Prisma drift 為空；隨機 disposable DB 已清除。
- `npm run test:http -- --dev`：通過。
- `npm run build`：通過，列出公開 checkout API、購物車頁及 Owner 訂單頁路由。
- `npm run test:http`：通過 production HTTP smoke。
- `npm run test:auth:http`：通過實際 Next + PostgreSQL + Mailpit 流程；包含訪客下單、server 價格、冪等重送、Owner 訂單查詢及 Member 拒絕。
- 本機 `npm run db:deploy`／`npm run db:status`：通過，為 `multi_tenant_dev` 套用第 12、13 份 additive migrations，狀態 up to date；未 reset 資料庫。
- GitHub Actions：Draft PR 建立後執行，結果待補。

本機人工瀏覽器試用可用 ECOM-002 專用假資料帳號；不把帳密或 `.env` 寫入 Git。
