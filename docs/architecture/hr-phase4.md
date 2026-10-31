# HR Phase 4：員工排班與出勤

HR 是 Django modular monolith 內獨立的業務模組。它擁有員工、班別、排班、考勤結果、不可變出勤事件及補登申請；不擁有平台登入帳號。員工可透過 `membership_id` 連結租戶登入資格，HR 透過 `platform_core.application` 公開契約驗證該資格，不建立跨模組 FK，也不直接寫入平台表。

## 第一版流程

1. 租戶管理員建立員工，並可連結同租戶已啟用的登入成員。未連結帳號的員工可先建檔，但尚不可排班。
2. 管理員定義班別的開始／結束時間與 IANA 時區（預設 `Asia/Taipei`）。結束時間早於開始時間代表跨午夜；同一時間不允許零時長班別。
3. 管理員將啟用員工排到啟用班別日期。系統拒絕同一員工重疊班次；跨日班次以實際時區區間檢查。
4. 員工本人可對自己的排班打卡；管理員／經理可代打卡。打卡時間只由伺服器產生，採冪等鍵，完成上班打卡後才可下班打卡。
5. 修正透過補登申請進行。租戶管理員核准或駁回；申請者不可核准自己的申請。核准會更新考勤讀取模型並追加更正事件，不修改既有事件。

## API

所有路徑都位於 `/api/v1/tenants/{tenant_id}/hr/`，使用同源 Session、租戶 membership 與 CSRF 保護。

| 方法與路徑 | 權限 | 用途 |
|---|---|---|
| `GET/POST employees/` | manager/admin；建立限 admin | 員工名冊與新增 |
| `PATCH employees/{id}/` | admin | 變更姓名、登入連結、啟用狀態（帶版本） |
| `GET/POST shifts/` | manager/admin；建立限 admin | 班別查詢與新增 |
| `GET/POST assignments/` | 已登入成員；建立限 admin | 排班查詢／新增；viewer 僅本人 |
| `POST assignments/{id}/clock-in/`、`clock-out/` | 本人，或 manager/admin | 伺服器時間打卡 |
| `GET/POST corrections/` | 已登入成員 | 查看／提出補登；viewer 僅本人 |
| `POST corrections/{id}/approve/`、`reject/` | admin | 審核補登 |
| `GET events/` | 已登入成員 | 最近 100 筆出勤事件；viewer 僅本人 |

管理員新增員工時可暫不連結帳號，但排班前必須連到同租戶有效成員。員工連結與員工狀態由管理員 PATCH；停用登入資格時，後端的平台契約會阻擋新的排班關聯。所有寫入透過 HR service，審計記錄建立、打卡與補登流程。

## 明確限制

目前不含休息時段、遲到／早退判定、加班計算、薪資、請假、排班通知或考勤匯出。DST 夏令時間切換時遇到不存在／重複的本地時間，第一版採 Python `zoneinfo` 預設 fold 行為；上線前需決定正式政策。停用員工或班別不刪歷史排班與事件。個資與出勤保存年限待確認。
