# ADR 0004：租戶內 Project 與保留資料的刪除

日期：2026-10-26。PROJECTS-001 / #9，使用者確認先交付 Project，再做 WMS 及其他業務模組。

採既有 Next/Prisma/PostgreSQL 工具鏈，不新增依賴。Project 是第一個業務資源，不將通用專案模型當作未來 WMS 庫存模型。授權由 signed session、active membership、active tenant 共同決定；Member/Owner 可讀取與新增編輯，Owner 可刪除，這些是第一版明示預設。

刪除使用 deleted_at 保留資料。原方案允許刪除，但永久清除與資料保留政策未核定；相較直接 DELETE，soft delete 避免不可逆清除。所有正常查詢與更新排除 deleted_at，不提供恢復入口，也不宣稱已建立完整保留政策。DB owner 仍可直接刪除或停用 trigger；runtime DB 角色分權另議。

使用整數 version 檢查過期修改，並沿用 M1 tenant row lock 序列化同租戶寫入與角色變更。這使交易內授權／更新／審計一致，犧牲同一租戶高頻寫入的並行度；未來需量測再調整，不單靠 UI 防重送。tenant/id、tenant/creator 的複合鍵保護邊界，保留停用成員歷史。

沿用 tenancy 平台公開 context/lock/audit 契約，避免業務 service 各自複製會員授權或直接寫 membership。現有 tenant_audit 可記錄資源 ID 的 project 動作；不新設內容型審計、不記錄名稱描述。新增任何子資源時必須使用 tenant/project 複合 FK。

邀請寄信真人驗收依使用者指示延後，追蹤 QA-001 / #8；不阻擋 Project 開發，也不能標示正式寄信已驗收。正式部署、RLS、任務、Agent、附件及 WMS 另開 Issue。
