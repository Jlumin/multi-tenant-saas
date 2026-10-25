# 資料庫設計

狀態：邏輯模型提案；沒有已執行 schema 或 migration。2026-10-26。

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
M0：空庫 apply migration 成功，tenants 表存在；重複 migration 不產生額外變更。
M1/M2：唯一性、FK、非法 role、缺 tenant_id 失敗；兩租戶交叉 CRUD 被拒絕；跨租戶 child FK 失敗；最後 owner 併發操作保護。
資料庫約束測試不取代 API 授權測試。
