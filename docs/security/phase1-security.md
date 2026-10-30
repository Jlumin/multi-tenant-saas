# Phase 1 安全狀態

已實作：同源 session 登入／登出、登入與 mutation CSRF、12 字元以上密碼及 Django validators、deny-by-default tenant membership、逐店查詢、superuser 無租戶繞過、最後管理員保護、審計同交易及資料庫 append-only guard。

登入每來源 IP 每分鐘 10 次，使用 DRF AnonRateThrottle 與本機 memory cache。這只適用目前單程序開發：重啟會重置，不能跨多程序共用，也不是強一致限流或完整帳號鎖定；正式部署必須加可信入口限流與共享 cache／身分服務。不得將不受信任的 X-Forwarded-For 當來源，反向代理需獨立設計。

Session 有效期 8 小時、HttpOnly、SameSite=Lax；DEBUG=0 時 session/CSRF cookies 為 secure。本機 HTTP 配置 DEBUG=1 僅供 localhost 開發。保留 Django 密碼 hash，不發 JWT、不將 session/token 寫入 localStorage。帳號全域 unique；建立失敗回通用訊息，但登入名稱是否可用仍可能由結果推知，正式公開註冊／邀請需另設流程。

租戶管理員能在自己租戶新增帳號及委派管理員，是高權限角色。禁止經 tenant API 修改全域 User 身分、密碼、is_active 或 is_superuser。provision_tenant 僅由可信維運操作，能將既有帳號綁入新租戶，應受到主機及 Docker 存取權控管。

審計不含敏感輸入。auth 全域事件供維運透過受控資料庫查詢，沒有全域審計 UI。租戶 API 不提供修改或刪除紀錄。審計／權限紀錄尚未外送、告警或實作保留期限，正式前應限制 runtime DB role 並安排保留與還原演練。

尚未完成：MFA、忘記密碼、邀請與密碼交付、強制首次改密碼、TLS/production server、shared throttle cache、RLS、正式 DB 角色分權、集中監控與災難復原。Phase 1 是可驗證的本機平台基礎，仍不可直接對外營運。
