# ECOM-001 驗證紀錄

日期：2026-10-28（本機）

## 自動驗證

- `npm run lint`：通過，ESLint 零警告。
- `npm run typecheck`：通過，Next route types 與 TypeScript。
- `npm test`：通過，3 個測試檔、10 項測試。
- `npm run db:validate`：通過，Prisma schema 有效。
- `npm run db:smoke`：通過，乾淨 PostgreSQL 套用全部 11 份 migration、重複 deploy 無變動、`ecom_stores`／`ecom_products` 存在且 Prisma schema drift 為空；專用測試庫已清除。
- `npm run test:auth`：通過，6 個 PostgreSQL integration 測試檔、74 項測試。E-Commerce 案例涵蓋已驗證 session、Owner/Member/非成員、兩租戶隔離、店面 slug／商品代碼唯一、價格與版本驗證、公開只顯示上架商品、停用店面隱藏、資料庫 FK／保留觸發器及 audit 交易回滾。
- `npm run test:http -- --dev`：通過，真實 Next 開發伺服器 health smoke。
- `npm run build`：通過，production build 將 `/shop/[slug]` 列為動態 server-rendered route。
- `npm run test:http`：通過，production server health smoke。
- `npm run test:auth:http`：通過，真實 Next + PostgreSQL + Mailpit 流程新增 E-Commerce 管理頁、建立店面與商品、匿名公開瀏覽、草稿隱藏、Member 可讀不可寫。
- Docker Compose PostgreSQL 與 Mailpit：兩個服務啟動並回報 healthy。

## 人工／產品確認

本機人工瀏覽器操作尚未執行。功能與驗證完成後，請一次確認以下暫定產品政策：

1. 一個租戶只設一間店；slug 全域唯一且建立後不可修改。
2. 幣別使用有效 ISO 4217 三碼；價格非負、最多兩位小數；有商品後不允許更換幣別；不含稅、折扣與運費。
3. E-Commerce 先有獨立商品目錄，不映射 WMS SKU／庫存；一商品沒有變體。
4. Owner 可建置及編輯店面與商品；Member 僅可讀管理目錄；匿名訪客只可瀏覽啟用店面的上架商品。
5. 此切片不含購物車、訂單、付款、配送、退貨、圖片上傳、搜尋、買家帳號或通知。

整個建置完成再人工檢查的邀請寄信，維持 QA-001 / Issue #8 追蹤，不納入 ECOM-001 驗收。GitHub Actions 結果於 Draft PR 建立後補記。
