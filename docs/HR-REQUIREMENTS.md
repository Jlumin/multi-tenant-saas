# HR 員工與出勤需求（HR-001）

狀態：第一版 HR-001 已依 Issue #32 實作，產品假設待整體建置驗收時確認。2026-10-28。

## 順序與模組邊界

使用者安排後續順序為 HR → Restaurant QR 點餐／POS → CRM → E-Commerce 金流。HR 擁有員工資料、出勤紀錄與租戶時區；只經平台的已驗證 session／membership 契約確認成員，不寫入 auth、tenancy 或其他業務模組的資料表。

## HR-001 第一版行為

- 員工需先是該租戶已啟用的 SaaS membership，由 Owner 將成員加入 HR 名冊。Owner 可設定選填員工編號及啟用狀態；不硬刪員工資料。
- 已驗證的 Owner／Member 若已啟用 HR 員工資料，可替本人上班與下班打卡、查閱自己的紀錄。Owner 可看本租戶員工名冊與出勤紀錄，並以必填原因追加更正紀錄。
- 打卡時間由伺服器產生、以 PostgreSQL `timestamptz` 儲存；瀏覽器不能指定時間或其他員工身分。租戶時區用於顯示與分日解讀，初始預設 `Asia/Taipei`。
- 同一員工最多有一筆未下班紀錄。Tenant row lock、冪等 request key 與 PostgreSQL partial unique index 一起防止重複及併發打卡。
- 出勤原始資料不可刪除；Owner 更正以 append-only adjustment 保留前值、修正值、原因、操作者及時間。若 membership 被停用後留下未結束班次，Owner 可以追加補登下班時間；未下班的員工 HR profile 不可停用。
- 只保存必要的員工編號與現有帳號顯示資料；一般日誌不寫出勤 payload 或更正原因。

## 不包含

非登入員工、共享 PIN／共用終端、代打、GPS／地理圍籬、裝置指紋、排班、輪班跨日政策、休假、加班核算、薪資、正式法遵、考勤匯出與外部薪資系統均不在 HR-001。未建立相應功能，不代表已具備相關政策。

## 待整體驗收確認

1. 員工是否必須已有 SaaS 帳號與有效租戶 membership。
2. 是否只接受登入本人打卡，或需要共享 kiosk／管理員代打。
3. 租戶預設時區是否為 `Asia/Taipei`，以及是否需要依門市／地點設定不同時區。
4. Owner 更正是否即時生效，或需第二人覆核。
5. 首版排除排班、休假、加班、薪資與位置驗證是否符合實際需求。

功能、資料表與驗證證據見 [HR-001 驗證紀錄](verification/HR-001.md)。
