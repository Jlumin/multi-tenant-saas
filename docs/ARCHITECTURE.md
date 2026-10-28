# 系統架構

狀態：初版提案保留於下方；M0/M1 已有工程，M2 Project 於 feat/projects-001 實作。2026-10-26。

實際選型與版本見 package.json、ADR 0001–0004。身分使用 Better Auth，Google 與電子郵件／密碼已實作；Project 的 tenant scope、交易與資料保留邊界見 [PROJECTS](PROJECTS.md)。下方原始提案不是最新交付清單。

## 技術預設提案
TypeScript + Next.js（App Router）作為單一 Web 應用與 server endpoints；PostgreSQL 儲存資料；Prisma 管理 schema/migrations；npm 與 lockfile；Vitest 作單元／整合測試。
此選擇服務第一版快速建立，不是現有技術事實。BOOTSTRAP-001 選定當時相容的受支援版本，固定依賴並記錄 Node 版本，不在文件捏造版本號。
登入供應商尚未選定；不自行設計密碼或 session 加密。

## 邊界與資料流
瀏覽器 → server endpoint → 身分驗證 → tenant/membership/role 授權 → tenant-scoped service → PostgreSQL。
UI 隱藏按鈕不構成授權；所有可直接呼叫的 endpoint 都必須檢查。
核心邏輯放在 server service，避免 UI、API 與背景工作各自複製授權邏輯。
建議目錄：src/app、src/server/auth、src/server/tenancy、src/server/services、prisma、tests；以實作實際結構更新文件。

## 租戶隔離
共享資料庫、共享 schema，每筆租戶資料有 tenant_id。
使用已驗證使用者與 membership 建立 server tenant context。URL/header 中 tenant ID 只是選擇器。
以 tenant_id + resource_id 查詢並驗證角色；跨租戶外鍵需複合約束。
資料存取封裝與兩租戶測試是初始控制。PostgreSQL RLS 是待 ADR 評估的額外控制；未實作與測試前不可宣稱已保護資料。
若採 RLS，須處理連線池、交易範圍 context、migration/service role 繞過風險。

## 業務模組邊界

模組提案與已核定的工程約束如下：

- `wms` 擁有商品主檔／實體庫存與倉儲交易；`ecommerce` 擁有線上商店交易流程；`crm` 擁有會員／客戶關係資料；`hr` 擁有員工／出勤；`restaurant` 同時擁有 QR 點餐與店員 POS。
- 每個模組維護自己的資料表與寫入權限。E-Commerce 是否引用 WMS SKU、使用 CRM 會員或和 Restaurant 共用部分服務，目前仍是產品與契約待決策事項，不能由模組名稱推定。
- 跨模組呼叫經由擁有方公開 service／contract；不能直接新增或更新其他模組的表。模組失敗、重試、冪等、事件順序與補償需由各整合 Issue 定義。
- 這些邊界與五模組 Modular Monolith 規劃一致，不表示各模組資料模型、API 或畫面已實作。

E-Commerce 需求與候選分期見 [ECOMMERCE-REQUIREMENTS.md](ECOMMERCE-REQUIREMENTS.md)。商品目錄與 WMS SKU、買家身份與 CRM、訂單與 Restaurant、支付／物流供應商的 owner 尚未最終核定。

ECOM-001 以 `ecom_stores`、`ecom_products` 作為 E-Commerce 私有表；Owner 寫入，Member 讀取，公開讀取僅依全域 slug 查找啟用店面及上架商品。公開路由不接受 tenantId。此目錄 slice 不建立 WMS SKU 外鍵或跨模組寫入。細節與暫定政策見 [ECOMMERCE-REQUIREMENTS.md](ECOMMERCE-REQUIREMENTS.md)。

ECOM-002 延伸至 E-Commerce 自有 `ecom_orders`／`ecom_order_lines`。公開 checkout 僅接受姓名/email、商品 ID/數量與高熵冪等鍵；服務端依 slug 重查啟用店面及上架商品，用 Decimal 重算價格並同交易寫入快照和匿名 metadata audit。checkout 與 Owner 商品／店面更新共用租戶列鎖，避免下架競態。Owner API 依已驗證 session、membership、role 與 tenant scope 回傳買家資料；Member、匿名及非成員不能讀訂單。資料庫 trigger 保護訂單快照不可更新／刪除，且只允許隨建立訂單的交易新增明細，提交時驗證總額、幣別與明細一致。購物車僅存 browser localStorage；沒有 WMS 庫存、CRM、付款或配送呼叫。訪客聯絡資料保存政策未定，僅限本機與測試環境。

WMS 與 E-Commerce 的商品映射、指定倉庫可售量、原子 reservation、履約、實物回倉釋回及到貨通知見 [ECOM-WMS-INTEGRATION.md](ECOM-WMS-INTEGRATION.md)。WMS contract 擁有 reservation 與庫存 movement 寫入；E-Commerce 不直接存取 WMS models。跨倉調撥預設關閉且只能經 WMS transfer service；公開目錄不能把其他倉庫數量合併。

HR-001 由 `hr` 擁有 `hr_employees`、`hr_attendance`、`hr_attendance_adjustments` 與 `hr_tenant_settings`。員工必須對應同租戶 active membership；HR 透過 tenancy public service 取得成員資料，不自行寫 membership。打卡只允許已登入本人、以 server timestamp 記錄；PostgreSQL 限制每人僅一筆未下班紀錄。Owner 更正採 append-only adjustment 與 tenant audit。HR 時區初始值 `Asia/Taipei` 是待最後產品確認的預設。細節見 [HR 需求](HR-REQUIREMENTS.md)。

RESTAURANT-001 由 `restaurant` 擁有 restaurant/menu/table/order tables。每 tenant 限一間餐廳；桌位 QR 只儲存 256-bit token 的 SHA-256 digest，公開服務以 digest 定位啟用桌位並回傳上架菜單。公開送單只接受商品 ID／整數數量與冪等 key；服務端重查價格並同交易寫訂單快照及匿名 tenant audit。Owner 管理主檔；Owner／Member 經 tenant membership 授權操作 POS。PostgreSQL 複合外鍵、append-only snapshot trigger、延遲總額驗證及狀態轉換 trigger 保護訂單。此切片沒有付款、WMS、CRM、KDS 或硬體整合。細節見 [Restaurant 需求](RESTAURANT-REQUIREMENTS.md)。

CRM-001 由 crm 擁有 crm_contacts，儲存 tenant 內客戶姓名、正規化 email／電話、選填備註及封存狀態。Owner 寫入，Owner／Member 經有效 tenant membership 查閱。所有查詢以 tenant 範圍執行，email／電話 unique、建立者 membership 複合 FK；封存不物理刪除。CRM 不直接寫入 E-Commerce／Restaurant 訂單或 identity tables，跨模組會員連結尚未核定。詳細欄位、個資假設見 [CRM 需求](CRM-REQUIREMENTS.md)。

## 健康檢查
M0 GET /api/health 僅回傳固定狀態且 HTTP 200，不公開環境、版本、連線字串或租戶資料。
這是 liveness，不代表資料庫 readiness；資料庫連通性由獨立本機／CI smoke test 證明。

## 環境與安全
只使用本機開發及 CI 測試資料；.env.example 只含範例。
資料庫帳密以環境變數設定，不提交真實秘密；正式 secrets manager 待部署選型。
結構化日誌包含 correlation ID 與必要事件，不包含 token、密碼或業務敏感內容。
正式部署、備份還原、限流、監控與事故處理另開 Issue。

## 驗證策略
M0 驗證健康檢查、工具鏈、DB migration、乾淨啟動與 CI。
M1 使用兩租戶、owner/member/非成員測試授權矩陣。
M2 對 CRUD 做完整跨租戶測試與端到端流程。
任何外部整合採測試替身與明確介面，不在 CI 使用正式客戶服務。

## 決策紀錄
尚無正式 ADR。重大選型或偏離本提案時新增 docs/adr/NNNN-title.md，記錄背景、選項、決策與影響。
