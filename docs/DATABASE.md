# 資料庫設計

狀態：邏輯模型提案；沒有已執行 schema 或 migration。2026-10-26。

以上是原提案起點。現在 M0/AUTH-001/TENANCY-001/PROJECTS-001/WMS-001 已有五份 versioned migrations；WMS-002 將新增第六份。實際模型以 prisma/schema.prisma 與 ADR 0002–0006 為準：身分為 auth_*、成員為 memberships、邀請為 invitations、平台審計為 tenant_audit，業務資源為 projects 與 WMS 主檔、文件及庫存流水。Project 採 tenant/creator 複合 FK、version 與 soft delete，詳見 [Project 資料與交易](PROJECTS.md)；WMS 主檔詳見 [ADR 0005](adr/0005-wms-masters.md)，庫存交易與餘額由流水同交易維護，詳見 [ADR 0006](adr/0006-wms-stock-posting.md)。原 auth_subject 由 Account(providerId,accountId) 支援多來源，見 ADR 0002。下方表格保留最初邏輯提案，不代表實際 SQL 表名。

## 模型
| 表 | 主要欄位 | 約束／用途 |
| --- | --- | --- |
| users | id UUID、auth_subject、created_at | auth_subject unique，對應身分供應商穩定識別碼 |
| tenants | id UUID、name、slug、created_at | slug unique；名稱不是授權依據 |
| memberships | tenant_id、user_id、role、created_at | PK(tenant_id,user_id)，FK tenants/users，role owner/member |
| projects | id UUID、tenant_id、name、created_by、created_at、updated_at | PK id；UNIQUE(tenant_id,id)，tenant_id 必填 |
| audit_events | id UUID、tenant_id、actor_user_id、action、resource_id、created_at | 租戶範圍 append-only；不存秘密與完整敏感 payload |

使用者可屬於多個租戶；角色屬於 membership，不能放在 users 作全域 tenant role。
時間欄位使用 PostgreSQL timestamptz，應用以 UTC 處理。
M0 僅需最小 tenants 表作 migration smoke test；其他模型於後續 Issue 實作，避免假裝已完成身分與授權。

ECOM-001 新增 `ecom_stores` 與 `ecom_products`。一店／租戶及公開 slug 均有唯一約束；商品以 `(tenant_id, store_id)`、建立者 membership 複合外鍵限制關聯；價格採 `numeric(12,2)`，資料庫檢查非負與代碼／版本格式。觸發器保留列、固定 slug 與 ownership，更新須遞增 version。商品目錄不外鍵連 WMS，符合模組資料所有權。

## 隔離與完整性
- 所有業務資料 tenant_id NOT NULL，索引以 tenant_id 起始以支援 scoped queries。
- 授權查詢必須使用有效 membership；變更角色與移除成員採交易保護最後一位 owner。
- projects.created_by 若要求為租戶成員，使用複合 FK (tenant_id,created_by) → memberships(tenant_id,user_id)；成員離開時的歷史保留政策需先決定。
- 後續 child table 引用 project 時使用 (tenant_id,project_id) → projects(tenant_id,id)，避免跨租戶關聯。
- tenant 刪除與 cascade 政策尚未批准；預設限制刪除，正式清除另行設計。
- audit actor 離開／刪除時的保留、匿名化與個資保存政策待定，不可直接 cascade 清除稽核。

## Migration 與開發
版本化 SQL migration 與 Prisma schema 同時提交；不對共享或正式資料庫直接 push schema。
本機可重設的測試庫須明確標示；破壞性指令只用於已確認為 disposable 的資料庫。
正式 migration 需部署計畫、備份與復原策略；不假設每個 schema 變更可用 down migration 無損還原。
種子資料只用虛構租戶與使用者，重複執行需可預期。

## 必要資料測試
M0/WMS：空庫 apply migration 成功；重複 migration 不產生額外變更且 Prisma schema drift 為空。
M1/M2：唯一性、FK、非法 role、缺 tenant_id 失敗；兩租戶交叉 CRUD 被拒絕；跨租戶 child FK 失敗；最後 owner 併發操作保護。
資料庫約束測試不取代 API 授權測試。
