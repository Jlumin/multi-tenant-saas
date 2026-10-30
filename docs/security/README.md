# 安全基線與後續門檻

Phase 1 已實作平台登入、租戶與門店權限及審計防護；Phase 2 新增 WMS 安全約束，見 [Phase 1 安全狀態](phase1-security.md) 與 [WMS Phase 2 安全規則](wms-phase2.md)。以下保留 Phase 0 基線與未來業務模組規劃。

Phase 0 不是可上線系統。沒有登入流程、RBAC、租戶隔離、QR token 或支付能力。DRF 預設 IsAuthenticated，只有 GET health 公開且不回傳資料庫細節。SessionAuthentication 只是預留機制，未開放取得 session 的端點。

Compose 僅綁定 localhost，PostgreSQL 不發布 host port。`.env.example` 是假值；複製為 .env 後更換密碼，不得提交。正式環境用 secret manager，DEBUG=0、限制 ALLOWED_HOSTS、HTTPS、secure cookies、CSRF trusted origins 與可信代理設定須部署時驗證。前端透過同源 /api proxy，不預先允許任意 CORS。

平台、WMS、CRM、E-Commerce、HR 及 Restaurant staff APIs 採 deny-by-default，需 membership 並依角色及門店範圍授權。唯一匿名業務 API 是 Restaurant 桌號 token 限定的菜單、下單與 QR SVG，點餐寫入要求 CSRF 並限流；沒有匿名購物 API。HR viewer 僅可查本人排班／出勤；Restaurant viewer 僅能在獲授權門店操作訂單及收現金，refund 需 manager/admin。兩租戶隔離與模組權限測試見 Phase 2–5 驗證；前端隱藏按鈕不能取代後端授權。

QR token 應高熵、可撤銷、限桌號／門店／有效期，不可用可猜測 ID 代替驗證；POS 高權限操作及退款需審計，員工離職撤權。Phase 3 目前只使用不連外 sandbox payment，不保存卡號；真實付款回呼驗簽、金額驗證、冪等及重放防護須另行實作。CRM 已保存會員姓名、Email、電話及同意歷史；個資留存及刪除政策仍待法規與情境確認。

日誌不得記錄密碼、token、支付或敏感個資；審計須記錄操作者、租戶、動作、時間與結果，限制讀取與竄改。上線門檻：威脅建模、依賴弱點審查、秘密掃描、備份還原、權限測試、部署 `check --deploy` 與 TLS 驗證。這些尚未宣稱完成。

Phase 6 已加入 Django HTTPS/HSTS/CSRF trusted-origin 設定與 production Compose 範本。只有在 Nginx 位於可信 TLS edge proxy 後方、該 proxy 覆寫 `X-Forwarded-Proto` 且是唯一入口時，才能啟用 proxy SSL 信任。操作條件與限制見 [Phase 6 runbook](../operations/phase6.md)。
