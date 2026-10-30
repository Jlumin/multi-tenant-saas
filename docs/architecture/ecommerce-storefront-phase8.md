# Phase 8：E-Commerce 客戶店面

狀態：使用者於 2026-10-31 明確要求新增客戶端介面。此切片包含租戶 opt-in 的公開唯讀商品型錄、品牌外觀、庫存有／無狀態與瀏覽器內購物清單。

## 入口與操作

- 租戶管理員在後台「品牌外觀與客戶店面」啟用／停用公開店面。資料欄位預設 `false`，新遷移不會自動公開既有租戶。
- 店面 URL 為 `/shop/{tenant_slug}/`；可從後台複製連結並以匿名瀏覽器開啟。
- 只顯示有效租戶的 active listing，且 WMS 商品與該 listing 指定的出貨倉庫皆為 active。倉庫商品上架保持一筆 listing 對一個出貨倉庫。
- 商品卡顯示標題、商品編號、售價、租戶 Logo／配色、商品圖片與「現貨供應／暫時缺貨」。對外只傳布林庫存狀態，不揭露可售數量。
- 前端提供搜尋、分頁載入與記憶體中的購物清單。購物清單不會建立訂單、預留庫存或保存客戶資料；結帳按鈕明確標示尚未開放。

## 公開 API

| Method | Route | 用途 |
|---|---|---|
| GET | `/api/v1/storefronts/{tenant_slug}/` | 啟用店面的品牌與上架型錄；可用 `q`、`limit`、`offset` 搜尋及分頁 |
| GET | `/api/v1/storefronts/{tenant_slug}/logo/` | 僅店面啟用時提供同租戶 Logo |
| GET | `/api/v1/storefronts/{tenant_slug}/products/{product_id}/image/` | 僅店面啟用且商品有啟用上架時提供 WMS 商品圖 |

上述端點都是匿名 read-only、60 requests/minute scoped throttle；關閉店面、停用 tenant 或下架 item 回 404。一般品牌管理與 WMS 圖片 API 保持原有 Session/RBAC 規則。店面 API 只讀 E-Commerce Listing 與平台品牌資料；WMS 圖片及可售量透過 `modules.wms.application` 公開 service contract 取得。

## 明確不包含

此 UI 是產品目錄與瀏覽器購物清單，不代表已具備顧客下單流程。公開 checkout 要先確定顧客登入或訪客身分、CRM 客戶資料／同意、收件與配送欄位、付款方式與 webhook、通知與缺貨到貨信、退款／退貨政策。真實支付、匿名訂單 API、會員註冊、到貨通知訂閱、物流與發票仍未實作。

production 部署公開 API 前須確認 trusted proxy client IP 設定、共享 cache 或 edge rate limiting、公開 tenant slug 與內容審核；不能僅依容器內記憶體節流保護多副本服務。
