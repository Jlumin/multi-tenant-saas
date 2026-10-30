# SME Cloud 架構與模組規劃

狀態：Phase 1 平台基礎、WMS Phase 2、Phase 3 CRM／E-Commerce、Phase 4 HR 第一版、Phase 5 Restaurant 第一版及 Phase 8 客戶店面第一版已實作，詳見 [Phase 1 決策與 API](phase1-platform.md)、[WMS Phase 2](wms-phase2.md)、[CRM／E-Commerce Phase 3](crm-ecommerce-phase3.md)、[HR Phase 4](hr-phase4.md)、[Restaurant Phase 5](restaurant-phase5.md) 與 [E-Commerce 客戶店面 Phase 8](ecommerce-storefront-phase8.md)。採 Monorepo + Modular Monolith：單一 Angular SPA、單一 Django/DRF 部署單元、單一 PostgreSQL 資料庫。未引入微服務、訊息佇列或背景工作系統。

## 版本決策

Node 24、Angular 21、TypeScript 5.9、Python 3.13、Django 5.2 LTS、DRF 3.16、psycopg 3.2、PostgreSQL 17。前端實際解析版本由 package-lock.json 固定；後端目前使用受限版本範圍，正式部署前須加入鎖版與雜湊及映像 digest。

參考：[Angular 相容表](https://angular.dev/reference/versions)、[Django 5.2](https://docs.djangoproject.com/en/5.2/releases/5.2/)。版本更新應獨立提交並驗證。

## 邊界

| 模組 | 責任與未來資料 | 主要流程 | 對外契約規劃 |
|---|---|---|---|
| WMS | 商品庫存識別、倉庫、儲位、庫存流水、預留量、盤點 | 入庫、出庫、調撥、盤點、取消預留 | 查詢可售量、預留／釋放／扣減；發布庫存變更 |
| E-Commerce | 上架內容、售價、購物車、訂單、支付及配送狀態 | 下單、付款回呼、取消、退貨 | 呼叫 WMS 預留、引用 CRM 會員；發布訂單及付款事件 |
| CRM | 會員、聯絡方式、同意紀錄、標籤、積分帳本 | 註冊、資料更新、同意撤回、積分調整 | 會員查詢、點數入扣帳；不擁有員工登入身分 |
| HR | 員工資料、班別、打卡事件、補登與核准 | 上下班打卡、補登、工時彙整 | 員工資格查詢、出勤報表；薪資計算不在初期範圍 |
| Restaurant | 桌號、共用菜單、餐單、付款事件、POS 班次 | QR 點餐、店員接單、送餐、現金結帳／退款、交班 | QR 與 POS 共用餐單服務；目前不串 CRM/WMS |

WMS 擁有商品主檔、實體庫存、預留及庫存流水；E-Commerce 擁有銷售上架與訂單，並透過 WMS service contract 預留／扣減。CRM 擁有租戶會員與同意歷史；CRM 會員、HR 員工及平台登入帳號分開建模。Restaurant 菜單與商品不是同一模型，初期不假設原料配方扣庫。公開 storefront／checkout、付款供應商、電子發票、物流、離線 POS 與打卡規則待確認。

## 依賴與契約

前端已有平台、WMS、CRM、E-Commerce、HR 及 Restaurant POS dashboard；桌邊 QR guest route 僅提供 token scoped 菜單與下單。後端每模組依 api → application/domain/service 分層，infrastructure 放持久化及外部整合。API 前綴 `/api/v1/`；Restaurant QR 端點是限定公開 API 例外，其餘業務 API 都需已登入租戶成員。

跨模組透過公開 application service 與版本化 DTO，禁止跨模組資料表寫入及循環 import。初期使用同步服務呼叫與明確 transaction.atomic；外部事件與通知待後續用 transactional outbox 設計，不以程序內事件保證交付。支付回呼、庫存命令、POS 結帳須具冪等鍵、唯一約束與重試語意。

共用平台包含租戶、門店、使用者身分、RBAC、審計、錯誤格式與 request ID。WMS、CRM、E-Commerce、HR、Restaurant 透過 membership/store application contract 與 audit service 取得範圍並記錄 metadata audit。

## 部署與取捨（ADR 0001）

選擇單程序邊界可降低初期維運成本，代價是模組共用部署及資料庫資源。保留契約邊界以便未來拆分，但不預先引入分散式交易。開發 Compose 使用 Django/Angular dev server；正式部署須另外設計 WSGI server、反向代理、TLS、靜態檔、監控、備份及發布回滾，不可直接對外開放本 Compose。
