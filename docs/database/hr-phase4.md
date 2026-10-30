# HR Phase 4 schema

Migration：`modules.hr.0001_initial` 建表，`0002_database_guards` 安裝 PostgreSQL 觸發器。所有 HR 業務列都包含 `tenant_id`；租戶範圍的唯一鍵、關聯驗證及 API 查詢共同防止跨租戶存取。

| Table | 內容與重要限制 |
|---|---|
| `hr_employee` | 員工代碼、姓名、啟用狀態、版本；同租戶員工代碼唯一，可選 `membership_id`（穩定 UUID、非 FK），同租戶連結唯一 |
| `hr_shift` | 班別代碼、名稱、時間、IANA 時區；租戶內代碼唯一。班別代碼、租戶及時間定義不可變，使用停用保留歷史 |
| `hr_shiftassignment` | 員工、班別與工作日期；保存建立者 membership ID，資料列不可更新或刪除；同員工／班別／日期唯一 |
| `hr_attendancerecord` | 排班的一對一當前打卡投影與版本；只允許 HR service 寫入，禁止刪除，資料庫檢查下班不早於上班 |
| `hr_attendanceevent` | 上下班及核准更正事件、實際時間、伺服器記錄時間、冪等鍵、payload digest、執行者；事件 append-only，租戶冪等鍵唯一 |
| `hr_correctionrequest` | 欄位、提議時間、原因、申請者、狀態、審核者及審核時間；申請 payload 保持不可變，只允許 pending → approved/rejected |

HR 帳號連結刻意不設跨模組 FK；建立排班／員工連結時呼叫 `platform_core.application.validate_membership_reference`。Assignment 指向同租戶 Employee 與 Shift，Event、Correction 同時核對 assignment 和 employee 關係。PostgreSQL trigger 要求建立排班者和補登審核者是有效租戶管理員；核准更正另以 deferred constraint trigger 確保事件及考勤投影在交易提交時一致。

考勤紀錄的 trigger 以交易區域設定 `hr.allow_record_write` 防止一般 ORM／SQL 寫入。service 只在短暫寫入區段開啟並隨即關閉；事件則完全不可更新／刪除。執行 migration 與測試須使用 PostgreSQL；不支援 SQLite 降級。
