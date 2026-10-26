# Project 專案管理

PROJECTS-001 / Issue #9，M2 第一個業務資源。使用者確認順序為 Project → WMS → 其他模組。依賴 M1 的真實 session、租戶與 membership。邀請寄信的真人補驗延後至整體建置完成，持續追蹤 [QA-001 / #8](https://github.com/Jlumin/multi-tenant-saas/issues/8)。

## 本機使用

沿用 DEVELOPMENT.md / AUTHENTICATION.md 的安裝與環境設定，先 `npm run db:deploy`，再 `npm run dev`。開啟 http://localhost:3000/projects，登入後選工作空間。沒有 membership 時請聯絡管理員，不提供公開建租戶。

所有有效成員（Owner、Member）可列出、新增、查看及編輯。名稱必填、trim 後 1–120 UTF-16 code units；描述選填、最多 2000，作純文字顯示。名稱可以重複。沒有排程、任務、狀態、附件或 Agent。

列表每頁 10 筆，支援上下頁；選取「查看／編輯」會重新讀取單筆版本。更新與刪除需傳目前 version；多人編輯遇到 409 時保留表單輸入，可用「重新載入專案」取得新版本後再修改。切換工作空間或重新整理列表會清除未儲存的編輯。

只有 Owner 能刪除；UI 先確認。此版本的刪除為 soft delete，資料及歷史審計保留，查詢和修改都視為不存在；不提供自行還原或永久清除。這是第一版保守預設，正式資料保存與清除政策另議。Member 看不到刪除按鈕，但 server 仍獨立驗證權限。

## API

前綴 `/api/projects/{tenantId}`，全部需要已驗證且未過期的 session 與有效 membership。URL tenantId 只選擇租戶，不代表授權。回應 no-store 與 X-Request-ID。

| 方法／路徑 | 請求 | 權限／回應 |
| --- | --- | --- |
| GET / | limit（1–100，預設20）、offset（0–100000） | 成員；items/total/limit/offset/role，依 createdAt/id 降序 |
| POST / | name、可選 description | 成員；201，建立者使用 server session |
| GET /{projectId} | 無 | 成員；單筆 |
| PATCH /{projectId} | name、可選 description、version | 成員；200，完整替換名稱／描述（省略描述會清空） |
| DELETE /{projectId} | version | Owner；200 `{deleted:true}` |

POST/PATCH/DELETE 必須同源 Origin 及 application/json，拒絕跨站。只接受白名單欄位；拒絕 tenantId、createdBy、deletedAt、role 等任意欄位，payload 最多 16384 字元。version 為 1 至 2147483646 的整數。

錯誤：匿名／未驗證401；非成員、其他租戶物件、已刪除404；同租戶 Member 刪除403；無效輸入400；過期版本409；過大payload413；相依服務錯誤503。錯誤只回 code/requestId，不回 DB 細節或跨租戶資訊。

## 資料與交易

第四份 migration 新增 projects。tenant_id 必填、建立者 (tenant_id,created_by) 複合 FK 指向 memberships；保留停用 membership 的歷史。包含 UUID、名稱、描述、建立／更新時間、version、deleted_at。tenant/id 複合唯一鍵及 tenant/deleted_at/created_at/id 索引。DB 檢查非空名稱與正版本，trigger 防止移動專案的租戶、建立者、ID、建立時間或修改已刪除紀錄。

Project service 透過 tenancy 的公開平台契約檢查 context、取得 tenant row lock 及記錄審計，不直接變更 membership。寫入先鎖同一 Tenant row，再檢查權限與版本，最後將 project mutation 與 project.created/updated/deleted metadata audit 在同一 transaction 提交。與 M1 角色變更共用 lock，避免撤權與寫入競態。每個租戶的寫入會序列化；大量寫入吞吐需後續評估。

審計不包含專案名稱／描述，只有 tenant/actor/target/request ID、動作與時間。版本衝突與失敗審計不得留下部分變更。讀取按照當次授權檢查時的有效狀態；沒有 DB RLS 或跨租戶超級管理。

## 驗證

沿用 CI 的 lint/typecheck/test/db:validate/db:smoke/test:auth/dev HTTP/build/production HTTP/test:auth:http。test:auth 自動包含 projects.postgres.ts，使用獨立 projects_test_* PostgreSQL、真實 Better Auth signed session。HTTP smoke 延伸至 Member 建立與編輯、409、Member 刪除403、第二租戶隔離404、Owner soft delete、刪除後404及登出。

這些自動化不會向外部真人寄信；保留 #8 的人工驗收。正式 SMTP、部署、RLS、永久清除、WMS 與其他模組均不在 PROJECTS-001 交付內。
