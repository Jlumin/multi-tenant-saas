# Phase 1 平台基礎

2026-10-26 使用者確認開始下一階段；範圍止於平台，不包含五個業務模組。所有平台模型、授權與服務放在 platform_core，不讓業務模組互相依賴。

## ADR 0002：登入身分與租戶身分

保留 Django 內建 User，因 Phase 0 已建立 auth migrations；本階段不切換 AUTH_USER_MODEL 或清空資料庫。User 的 integer PK 為全域技術身分；Tenant、Store、Membership、AuditEvent 使用 UUID。會員資料（CRM）與員工資料（HR）仍未建立，不將它們混入 User。

同一使用者可有多個租戶成員資格。每次請求由 URL 中的 tenant UUID 搭配伺服器端 Membership 查詢取得 scope，不相信 body 的 tenant_id、瀏覽器目前選取值或 Django is_superuser。非成員／停用租戶／停用成員回 404，已加入租戶但角色不足回 403。

## 權限矩陣

| 能力 | 租戶管理員 admin | 門店管理員 manager | 檢視者 viewer |
|---|---|---|---|
| 查看自身與已加入租戶 | 可 | 可 | 可 |
| 讀取門店 | 同租戶全部（含停用） | 僅指派且啟用門店 | 僅指派且啟用門店 |
| 建立、更新及啟停門店 | 可 | 不可 | 不可 |
| 建立新帳號及租戶成員 | 可 | 不可 | 不可 |
| 改角色、啟停成員、逐店授權 | 可 | 不可 | 不可 |
| 查閱租戶審計紀錄 | 可 | 不可 | 不可 |
| 修改／刪除審計、刪除租戶 | 無 API | 無 API | 無 API |

manager 與 viewer 在本階段都是門店讀取權限；未來的庫存、POS 等操作需在其模組規格確認後加入，不能依角色名稱推導額外權限。admin 不需逐店指派。停用門店不清除既有指派；重新啟用後既有授權恢復。

Membership 變更在 transaction.atomic 內鎖 Tenant row，序列化同租戶變更，避免兩位管理員同時降權而移除最後管理員。最後一位 active 且 User active 的管理員不得降權或停用。帳號全域啟停僅限維運；維運仍須確保租戶管理員可恢復。

## ADR 0003：同源 Session 與本機平台 UI

Angular 使用同源 fetch、HttpOnly session cookie，憑證不存 localStorage。登入前 GET CSRF，登入 POST 明確 csrf_protect，登入後 token 輪換；其他 mutation 由 DRF SessionAuthentication 驗證 CSRF。登出使 session 失效。帳號密碼不回傳，表單密碼在完成送出後清空。

租戶首次建置由可信維運 CLI 完成，不開放公開註冊。管理 UI 可建立新帳號；既有全域帳號不得被租戶管理員重新設密碼或任意綁入租戶，多租戶連結由 provision_tenant CLI 處理。沒有忘記密碼、MFA、邀請信或個人密碼變更功能；正式營運前需另行規劃。

## 平台 API

所有路徑以前綴 `/api/v1` 開始。修改使用 JSON，Session mutation 需 X-CSRFToken。

| 方法與路徑 | 說明 |
|---|---|
| GET /auth/csrf/ | 公開取得 CSRF token |
| POST /auth/login/ | username/password 登入；回傳輪換後 csrfToken |
| POST /auth/logout/ | 登出，需登入與 CSRF |
| GET /auth/me/ | username 與 active memberships（tenant_id/name/role） |
| GET /tenants/{tenant}/stores/ | 授權範圍內門店列表 |
| POST /tenants/{tenant}/stores/ | admin 建門店：name、code、可選 is_active |
| GET /tenants/{tenant}/stores/{store}/ | 經 scope 查門店 |
| PATCH /tenants/{tenant}/stores/{store}/ | admin 更新 name/code/is_active |
| GET /tenants/{tenant}/members/ | admin 查租戶成員 |
| POST /tenants/{tenant}/members/ | admin 建新帳號：username/password、可選 role/is_active/store_ids |
| PATCH /tenants/{tenant}/members/{member}/ | admin 更新 role/is_active/store_ids；不可改 username/password |
| GET /tenants/{tenant}/audit/ | admin 唯讀審計列表 |

列表回 `{count,next,previous,results}`，預設 50、最多 100，使用 limit/offset。UI 顯示最多 100 門店／成員、最近 50 審計，明示顯示筆數；更大量管理目前可透過分頁 API，UI 尚無翻頁控制。門店唯一鍵為 tenant+code。角色預設 viewer，新帳號未指派門店前沒有門店存取權。

已處理的 DRF 錯誤回 `{error:{code,details,request_id}}`；CSRF 拒絕同樣回 JSON。每個回應有伺服器產生的 X-Request-ID，不信任外部注入的 ID。未註冊路由仍由 Django 處理，dev DEBUG 可能回 HTML；不要將 DEBUG 開發環境對外發布。

審計紀錄含租戶、actor ID、action、target ID、request ID、時間，不存 body、密碼、使用者輸入的登入帳號或 IP。成功寫入與審計在同交易內；審計寫入失敗時平台寫入回滾。登入／登出及失敗登入另記全域事件（tenant=NULL），租戶 API 不公開全域事件。授權檢查拒絕會記 access.denied；不存在的物件拒絕不另外記詳細內容。
