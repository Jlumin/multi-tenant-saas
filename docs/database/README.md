# 資料庫規劃

Phase 1 已新增平台 schema，並保留內建 Django User；目前狀態與原 Phase 0 規劃差異見 [Phase 1 schema](phase1-schema.md)。以下保留業務資料規劃與 Phase 0 起點。

Phase 0 使用 PostgreSQL 17；不建立業務 models 或 migrations。`migrate` 僅建立 Django auth/contenttypes/sessions 內建表，不代表會員、員工或租戶功能完成。正式首次業務 migration 前決定自訂 User；本機資料庫可重建，既有資料不可逕行刪除。

平台與 WMS 業務主鍵使用 UUID，時間用 timezone-aware UTC 儲存、Asia/Taipei 顯示；金額使用 Decimal + currency，禁止浮點數。WMS 數量依使用者確認採整數，包裝轉基本單位保存正整數快照；其他模組數量精度由其需求決定。庫存、點數、打卡及付款採不可任意覆寫的流水，調整透過反向／更正紀錄。

租戶採 shared database/shared schema，所有租戶業務表必須有 tenant_id，門店資料另有 store_id；唯一約束與索引包含 tenant_id，查詢、關聯驗證及背景工作強制租戶範圍。RLS 是否作第二道防線需 ADR；目前不具隔離能力。

WMS Phase 2 新增 product/packageunit/warehouse/location/inventorydocument/documentline/stockbalance/stockmovement；Phase 3 新增 WMS stockreservation/stockreservationline、CRM customer/consentevent、E-Commerce listing/order/orderline/payment；Phase 4 新增 HR employee/shift/shiftassignment/attendancerecord/attendanceevent/correctionrequest；Phase 5 新增 Restaurant table/menu category/item/order/orderline/order event/POS shift/payment event，schema 與 PostgreSQL guards 見 [WMS Phase 2](wms-phase2.md)、[CRM／E-Commerce Phase 3](crm-ecommerce-phase3.md)、[HR Phase 4](hr-phase4.md) 與 [Restaurant Phase 5](restaurant-phase5.md)。購物訂單與餐飲訂單維持不同模型。

跨模組引用使用穩定 ID 及公開服務驗證；同模組可用 FK。跨模組 FK 的刪除與遷移耦合須逐案審查，預設禁止級聯刪除。庫存預留與扣減須 transaction.atomic、鎖或條件更新，並有資料庫約束避免超賣。

Migration 納入 Git、CI 檢查未提交變更；採擴充→回填→切換→移除，避免同次發布破壞欄位。正式備份需加密、異地保存、定期還原演練，RPO/RTO 與保留期在上線前確認。Compose volume 是本機持久化，不是備份。不要對有用資料執行 `down -v`。Phase 6 提供本機 pg_dump 與隔離 database restore drill，未提供加密或 offsite 複製；詳見 [操作手冊](../operations/phase6.md)。
