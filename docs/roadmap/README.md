# 路線圖與停止點

| 階段 | 範圍 | 驗收門檻 |
|---|---|---|
| Phase 0 | 文件、五模組空結構、開發環境、健康檢查、CI | build/check/測試結果可追溯，限制明列；完成即停止等待確認 |
| Phase 1（2026-10-26 已核准） | 租戶、身分、門店、RBAC、審計及 API 共用規範 | 隔離負向測試、權限矩陣、User/schema 決策；見 phase1-validation.md |
| Phase 2（2026-10-29 使用者要求繼續；WMS 第一版已實作） | 商品與整數包裝單位、倉庫／儲位、入庫／出庫草稿、admin-only 原子過帳、餘額及 append-only 流水 | PostgreSQL migration/guards、兩租戶授權、冪等、rollback、並發與禁止負庫存測試；驗證見 [WMS Phase 2](phase2-wms-validation.md) |
| Phase 3（2026-10-29 已核准；內部 CRM／E-Commerce 第一版已實作） | CRM 會員與同意、登入限定的商品上架／訂單、WMS 庫存預留與 sandbox 付款 | PostgreSQL migration/guards、租戶/RBAC、取消釋放、sandbox capture 扣庫、個資與狀態一致性；見 [Phase 3 驗證](phase3-validation.md) |
| Phase 4（2026-10-30 已核准；HR 第一版完成） | HR 員工、班別、排班、打卡及補登核准 | PostgreSQL migrations/guards、時區與跨日、租戶/RBAC、冪等、雙人核准及隱私測試；見 [Phase 4 驗證](phase4-validation.md) |
| Phase 5（2026-10-30 已核准；第一版完成） | Restaurant 共用菜單、QR 訪客點餐、店員 POS、現金收退與班次交接 | scoped token/CSRF/throttle、租戶及門店 RBAC、冪等、金額快照、append-only 付款、交班測試；見 [Phase 5 驗證](phase5-validation.md) |
| Phase 6（2026-10-30 已核准；營運準備完成） | 整合、營運及上線準備 | 備份／隔離還原工具、production Compose、HTTPS 安全設定、健康檢查與回滾流程；尚未部署或執行正式環境演練 |

上述模組順序仍以各階段核准為準。Phase 1 已確認 shared database 租戶模式、本機 Django User 及同源 Session；Phase 2 WMS 未包含期初、調撥、盤點或 legacy Mini WMS 資料匯入。Phase 3 目前是內部驗證流程，公開 storefront、真實金流、寄信、退款、物流與發票未啟用。管理員邀請信寄送已依使用者指示暫緩，記錄為全模組建置完成後的整體人工驗證項目。Phase 4 HR 第一版已完成；休息時間、遲到／加班判定、DST 特殊時間政策及個資資料保留政策待最後確認。Phase 5 Restaurant 第一版已於 2026-10-30 核准並完成；菜單稅費、折扣、小費、印單及最終保存政策待最後確認。Phase 6 已補上上線準備基礎，正式部署前仍須決定網域/TLS 代理、備份 RPO/RTO 與保存週期、負載目標及監控告警接收對象；不代表已上線。
