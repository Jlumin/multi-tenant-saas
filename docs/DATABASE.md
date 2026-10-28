# 資料庫設計

狀態：下方初始邏輯模型為提案；實際 schema 與已執行 migration 以本文件的版本化補充及 `prisma/schema.prisma` 為準。2026-10-28。

以上是原提案起點。M0、AUTH-001、TENANCY-001、PROJECTS-001、WMS-001–005 與 ECOM-001/002 已有 versioned migrations。實際模型以 prisma/schema.prisma 與 ADR 0002–0006 為準：身分為 auth_*、成員為 memberships、邀請為 invitations、平台審計為 tenant_audit，業務資源為 projects、WMS 主檔／文件／庫存流水及 E-Commerce 店面／商品／訂單快照。Project 採 tenant/creator 複合 FK、version 與 soft delete，詳見 [Project 資料與交易](PROJECTS.md)；WMS 主檔與庫存交易分別見 [ADR 0005](adr/0005-wms-masters.md) 與 [ADR 0006](adr/0006-wms-stock-posting.md)。原 auth_subject 由 Account(providerId,accountId) 支援多來源，見 ADR 0002。下方表格保留最初邏輯提案，不代表實際 SQL 表名。

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
M0 僅需最小 tenants 表作 migration smoke test；後續模型依對應 Issue 版本化提交。

ECOM-001 新增 `ecom_stores` 與 `ecom_products`。一店／租戶及公開 slug 均有唯一約束；商品以 `(tenant_id, store_id)`、建立者 membership 複合外鍵限制關聯；價格採 `numeric(12,2)`，資料庫檢查非負與代碼／版本格式。觸發器保留列、固定 slug 與 ownership，更新須遞增 version。商品目錄不外鍵連 WMS，符合模組資料所有權。

ECOM-002 新增 `ecom_orders` 與 `ecom_order_lines`。訂單與明細皆帶 `tenant_id`／`store_id`；明細以複合外鍵同時參照所屬訂單與商品，避免跨租戶／跨店關聯。商品代碼、名稱、單價、數量、明細金額、幣別與總額在下單當下保存；數量限制 1–99，金額採 `numeric(12,2)`。資料庫 trigger 拒絕修改或刪除訂單與明細、拒絕事後新增明細，並於交易提交時檢查至少一筆明細、總額及店面幣別一致。修正需後續另定沖銷／狀態流程。高熵冪等鍵保存 SHA-256 摘要，含個資 payload 保存伺服器秘密 HMAC 摘要。訪客姓名及 email 目前明文存於訂單表；保存期限尚未核定，功能限本機／測試，不得視為正式營運就緒。下單、明細、總額與匿名 metadata audit 同一交易提交；Owner 才能查看本租戶訂單。

ECOM-003 新增店面 `warehouse_id` 及商品／訂單明細的 WMS SKU reference（刻意不加跨模組 FK），WMS 租戶設定、reservation header/lines 與 E-Commerce restock subscription。Reservation line 固定租戶、SKU、倉庫、儲位與正整數基本量；資料庫拒絕修改或刪除 reservation content，狀態僅能由 active 轉 fulfilled/released。履約 WMS outbound posting 與 reservation transition 共用交易；釋回不修改餘額，必須另有 WMS inbound/return。Restock subscription 以 HMAC email hash 做每商品冪等唯一性，保留退訂 token 雜湊、通知狀態與嘗試次數；email 為寄送所需的個資欄位，不得進日誌。跨倉設定預設 false。

HR-001 新增 `hr_employees`、`hr_attendance`、`hr_attendance_adjustments`、`hr_tenant_settings`。員工以 `(tenant_id,user_id)` 複合 FK 對應本租戶 membership；出勤只對應 HR employee。partial unique index 保證每位員工最多一筆 `clock_out_at IS NULL`；clock-in/out 冪等鍵以租戶為範圍唯一。PostgreSQL trigger 禁止刪除出勤或修改原始 clock-in，並只允許首次補上 clock-out；更正表 append-only，可記錄漏打下班的補登。時區設定租戶範圍且預設 `Asia/Taipei`，目前為待產品確認的提案預設。

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
