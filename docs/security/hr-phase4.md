# HR Phase 4 security rules

- 每個 API 先驗證已登入 Session，再由平台公開 membership contract 確認租戶有效資格；無資格或不存在租戶以拒絕回應處理。
- Viewer 只看自己帳號連結的員工排班、補登與事件，不能讀取人員名冊、建立班別／排班或替他人打卡。Manager 可讀排班名冊與代打卡，但不能建立員工、班別、排班或審核補登。Admin 建立員工、班別、排班及審核補登。
- 管理員不能核准以自己登入使用者提出的補登；資料庫 trigger 再次驗證申請者與審核者是不同有效使用者及審核者為同租戶 admin。
- 打卡時間由後端 `timezone.now()` 產生，客戶端不提供打卡時間。冪等鍵限制重試效果；同鍵不同工作內容回應衝突。時間更正走新事件，原始事件禁止修改或刪除。
- 員工會員連結不採跨模組 FK；每次建立或更改連結都透過平台契約確認同租戶且帳號有效。資料庫 guard 再驗證 employee、shift、assignment、attendance、event 及 correction 的租戶關係。
- PostgreSQL guards 保護不可變資料、補登狀態轉換及考勤投影；前端按鈕隱藏僅為 UX，後端與 DB 權限才是安全邊界。Session mutation 維持 CSRF 防護。
- API 不回傳平台帳號 Email 或密碼；HR 只顯示員工姓名／代碼與管理員有權查看的帳號名稱。Production retention、個資刪除及法遵政策尚待確認。
