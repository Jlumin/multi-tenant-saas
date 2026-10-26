# ADR 0003：管理員建租戶、邀請與隔離

日期：2026-10-26；使用者明確選擇「管理員建立租戶並邀請成員」。TENANCY-001 / #6 接續 AUTH-001。

## 身分與範圍

管理員指可信維運操作：CLI 以既有已驗證 User UUID 建立新 Tenant 與第一位 Owner，沒有預設帳密／公開 bootstrap／自助建租戶路徑，也沒有可瀏覽所有租戶的 platform admin。tenant.provisioned 審計 actor=NULL，代表維運而非假冒首位 Owner。

Member 與 Owner 都屬 (tenant_id,user_id) 的 active membership；User 不存全域租戶角色。Owner 管理同租戶成員／邀請及審計，Member 只能查看已加入租戶的基本資料。本階段沒有業務資源或 CRUD。停用 Tenant／Membership、未驗證 User、無效／已登出 session 都拒絕；URL UUID 只是選擇器。API 不接受 body tenant_id、role=superadmin 或身分 header 當授權依據。

租戶選取不寫入可授權的 cookie；每次 server 依 Better Auth DB session 取 User，再以 tenant+user 查 active membership。非成員／外租戶 404；同租戶非 Owner 管理操作 403。修改需完全相同 Origin、JSON，拒絕跨站來源。限量分頁預設 50、最大 100。

## 交易與邀請

租戶的 mutation 先鎖 Tenant row，再重新檢查 actor membership。最後一位有效 Owner 不能降權／停用，兩位 Owner 併發自我降權只會有一個成功；邀請接受也使用同一把 row lock。

邀請為 32-byte cryptographic random bearer token，DB 只存 SHA-256 hash；24 小時、單次、限已驗證且 email 完全匹配的 User。token 是授權能力，不能記錄或公開 API 回傳。對同 email 重邀會撤銷先前待用 token；角色變更／停用也撤銷該人的待用邀請，失去 Owner 資格時撤銷其簽發邀請，接受時再次檢查簽發人資格。

Owner 每租戶每小時最多新建 20 份邀請，計數在同一 DB lock/transaction，包含寄送失敗，避免多程序繞過純記憶體限制。接受邀請不是根據客戶端給的 role/email 建 membership，而是讀回 DB 的 invitation 決策。

DB 建立邀請／審計後才 SMTP 投遞；投遞失敗會撤銷仍待用 token 並寫 delivery_failed。DB 與 SMTP 不可能同一原子交易：timeout 可能已投遞但 token 已失效，操作者須重新邀請；未實作 outbox/retry worker，不宣稱 exactly-once。失敗時不將 token 當補救連結回傳 API。

## schema 與限制

新增 memberships（複合 PK、DB role enum、active）、invitations（creator 的複合 tenant/user FK）、tenant_audit（只存 IDs/固定動作/request ID）。Tenant 新增 is_active DEFAULT true。成員停用不刪 row，歷史 inviter／audit FK 均 Restrict。

SQL trigger 禁止 Membership 改 tenant/user identity，審計 UPDATE/DELETE 被拒；邀請 accepted/revoked 不得同時存在。runtime 與 DDL 帳號正式分權尚未實作，DB owner 可停用 trigger 或 TRUNCATE，因此不宣稱防 DBA 竄改。未啟用 RLS；隔離仰賴 server scope、複合 FK 與測試。

拒絕記錄是 request ID/status/code metadata console log；已成功的租戶變更與 DB 審計同交易，audit 失敗時 mutation rollback。沒有記 email body／token／密碼，沒有實作正式 log 收集與留存。

新登入帳號不自動加入租戶；停用成員只能由 Owner 明確重新邀請或重新啟用恢復權限。現有無成員資格的舊 Tenant 不會自動指定 Owner，需另行審核遷移，不猜測擁有權。
