# Phase 3 CRM 與 E-Commerce

狀態：使用者已核准，Phase 3 內部工作流程第一版已實作。所有業務 API 都要求平台 Session 與租戶 Membership；不提供匿名購物網站 API。

## 功能邊界

- CRM 維護租戶會員代碼、姓名、Email、電話及啟停狀態。會員代碼建立後固定；停用採保留資料的軟狀態。
- Email／簡訊行銷同意、撤回及服務條款記錄採 append-only 事件。每筆記錄包含用途、狀態、政策版本、操作者及時間；撤回會新增事件，不改寫先前紀錄。
- E-Commerce 上架項目引用 WMS 商品與單一出貨倉庫，以租戶內唯一 `(product_id, warehouse_id)` 維護網站標題、幣別與售價。上架庫存是 WMS 實體量扣除有效預留量；不同倉庫不互相調貨。
- 內部訂單引用 CRM 會員，保存會員與商品售價快照。下單在同一 PostgreSQL 交易內呼叫 WMS 公開 service contract 預留庫存；取消未付款訂單會釋放預留。
- 內部 sandbox capture 只模擬付款成功，不連接支付供應商、不收款；成功後由 WMS service contract 依倉庫產生出庫單與不可變庫存流水。已付款訂單本切片不能取消或退款。
- WMS 一般出庫不得耗用其他訂單的有效預留量；商品、倉庫或儲位有有效預留時不可停用。

## 權限與 API

商品上架清單可由該租戶已登入成員讀取；CRM 會員個資與 E-Commerce 訂單僅限 `admin`／`manager` 讀取。CRM 建立／更新會員、紀錄同意，以及 E-Commerce 上架、建立訂單、sandbox capture、取消皆限 tenant `admin`（Owner）。所有 mutation 經 SessionAuthentication + CSRF。會員 `email` 與 `phone` 不寫入審計 metadata；訂單為履約保留會員姓名與 Email 快照。

| Method | Route | 用途 |
|---|---|---|
| GET/POST | `/api/v1/tenants/{tenant_id}/crm/customers/` | 搜尋／新增會員 |
| GET/PATCH | `/api/v1/tenants/{tenant_id}/crm/customers/{customer_id}/` | 會員檢視／版本化更新、讀取同意歷程 |
| GET/POST | `/api/v1/tenants/{tenant_id}/crm/customers/{customer_id}/consents/` | 讀取／追加同意或撤回事件 |
| GET/POST | `/api/v1/tenants/{tenant_id}/ecommerce/listings/` | 列出上架與可售量／新增指定商品與倉庫上架 |
| GET/POST | `/api/v1/tenants/{tenant_id}/ecommerce/orders/` | 查詢／建立內部待付款訂單並預留庫存 |
| POST | `/api/v1/tenants/{tenant_id}/ecommerce/orders/{order_id}/cancel/` | 取消待付款訂單並釋放庫存 |
| POST | `/api/v1/tenants/{tenant_id}/ecommerce/orders/{order_id}/capture-sandbox-payment/` | Owner 模擬付款並由 WMS 扣庫 |

CRUD inputs 拒絕未知欄位；tenant、actor、商品價格與訂單快照由服務端驗證或推導。CRM／E-Commerce 寫作僅更新本模組資料；跨模組讀寫透過 `modules.crm.application` 及 `modules.wms.application`，不建立跨模組業務 FK。WMS 的預留服務鎖定 tenant row，序列化庫存過帳與預留，避免併發超賣。

## 明確保留

公開 storefront／匿名 checkout 尚未開放；目前公開 API 限制只允許健康與登入 bootstrap/login。Google／Email 客戶登入、購物車、付款供應商 webhook、Email 寄送與到貨通知、付款退款、物流、電子發票、逾時預留清理、點數帳本及個資保留／刪除政策不在此切片。這些需規劃或確認後再實作。
