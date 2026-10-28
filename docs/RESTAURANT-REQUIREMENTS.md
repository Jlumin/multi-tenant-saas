# Restaurant QR 點餐與店員 POS（RESTAURANT-001）

狀態：首版依使用者選定的模組順序開發，初始商業規則列為待整體試用確認。此切片提供一間餐廳、桌位 QR、菜單、訪客送單與店員訂單狀態處理；不是正式營運或付款系統。

## 範圍與權限

- 一個 SaaS tenant 最多一間餐廳；新建餐廳以 TWD 為幣別，Owner 可啟用／停用。
- Owner 建立餐點分類、商品和桌位。Menu item 建立後可上架；商品代碼在同一餐廳唯一。
- 每桌 QR 使用 256-bit 隨機 token。資料庫只存 SHA-256 digest；只在建立或 Owner 輪替當下回傳原始 QR URL。輪替後舊 QR 立即失效。
- 公開訪客掃 QR 看該桌餐廳的啟用分類及上架商品，送出餐點 ID 與整數份數。伺服器驗證菜單狀態、重查價格並建立 immutable item/price/total snapshot；訪客輸入不含價格、租戶或桌位識別。
- Owner／Member 可看同租戶 POS 訂單並處理狀態；非成員與跨租戶使用者無法讀取。所有管理 API 以已驗證 session、active membership 和 tenant scope 授權；Owner-only 主檔寫入由後端檢查。
- 訂單使用高熵冪等 key；同 key 與相同桌位／payload 回傳既有訂單，不同 payload 拒絕。訂單和明細不可更新／刪除，DB trigger 保證總額與明細一致。
- 狀態只允許 `pending → accepted → preparing → ready → completed`；`pending` 或 `accepted` 可取消。狀態變更會寫入同交易 tenant audit。

## 不包含

不含線上支付、退款、稅／服務費、外送／外帶、訂位、客戶帳號、CRM、WMS 庫存扣減、桌位併單／拆單、廚房 KDS、印表機、硬體 POS、訂單修改／刪單、多人覆核、菜單圖片、多語言與營運報表。未實作不表示已具備相關政策。

## 待整體驗收確認

1. TWD 是否為首發及唯一幣別，稅與服務費是否需要納入訂單總額。
2. 餐廳、菜單分類、餐點與桌位是否允許多筆；目前一 tenant 一餐廳，沒有軟刪除介面。
3. 哪些狀態可由店員取消，取消後是否應保留原因或需要 Owner 核准。
4. QR token 是否要到期、限制來源或提供掃碼次數／速率保護。
5. 下單是否需要桌邊備註、特殊需求、加料、組合餐及訪客姓名。
6. 是否需小票、廚房單、桌位結帳、併桌、拆單與付款對帳。

功能與 PostgreSQL 驗證證據見 [RESTAURANT-001 驗證紀錄](verification/RESTAURANT-001.md)。
