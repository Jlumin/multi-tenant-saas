# 安全基線與後續門檻

Phase 1 已實作平台登入、租戶與門店權限及審計防護；Phase 2 新增 WMS 安全約束，見 [Phase 1 安全狀態](phase1-security.md) 與 [WMS Phase 2 安全規則](wms-phase2.md)。以下保留 Phase 0 基線與未來業務模組規劃。

Phase 0 不是可上線系統。沒有登入流程、RBAC、租戶隔離、QR token 或支付能力。DRF 預設 IsAuthenticated，只有 GET health 公開且不回傳資料庫細節。SessionAuthentication 只是預留機制，未開放取得 session 的端點。

Compose 僅綁定 localhost，PostgreSQL 不發布 host port。`.env.example` 是假值；複製為 .env 後更換密碼，不得提交。正式環境用 secret manager，DEBUG=0、限制 ALLOWED_HOSTS、HTTPS、secure cookies、CSRF trusted origins 與可信代理設定須部署時驗證。前端透過同源 /api proxy，不預先允許任意 CORS。

平台、WMS、CRM、E-Commerce、HR 及 Restaurant staff APIs 採 deny-by-default，需 membership 並依角色及門店範圍授權。匿名業務 API 包含 Restaurant 桌號 token 限定的菜單、下單與 QR SVG，以及 Phase 8 租戶管理員明確啟用後的 E-Commerce 公開唯讀商品型錄與上架圖片；兩者均限流。客戶店面不接受匿名寫入、不公開精確庫存或會員／訂單個資。HR viewer 僅可查本人排班／出勤；Restaurant viewer 僅能在獲授權門店操作訂單及收現金，refund 需 manager/admin。兩租戶隔離與模組權限測試見 Phase 2–5 及 Phase 8 驗證；前端隱藏按鈕不能取代後端授權。

QR token 應高熵、可撤銷、限桌號／門店／有效期，不可用可猜測 ID 代替驗證；POS 高權限操作及退款需審計，員工離職撤權。Phase 3 目前只使用不連外 sandbox payment，不保存卡號；真實付款回呼驗簽、金額驗證、冪等及重放防護須另行實作。CRM 已保存會員姓名、Email、電話及同意歷史；個資留存及刪除政策仍待法規與情境確認。

日誌不得記錄密碼、token、支付或敏感個資；審計須記錄操作者、租戶、動作、時間與結果，限制讀取與竄改。上線門檻：威脅建模、依賴弱點審查、秘密掃描、備份還原、權限測試、部署 `check --deploy` 與 TLS 驗證。這些尚未宣稱完成。

Phase 6 已加入 Django HTTPS/HSTS/CSRF trusted-origin 設定與 production Compose 範本。只有在 Nginx 位於可信 TLS edge proxy 後方、該 proxy 覆寫 `X-Forwarded-Proto` 且是唯一入口時，才能啟用 proxy SSL 信任。操作條件與限制見 [Phase 6 runbook](../operations/phase6.md)。

Phase 7 新增租戶品牌與受保護的圖片上傳；格式、大小、像素、CSRF、租戶隔離與 media volume 規則見 [Phase 7 圖片安全](tenant-assets-phase7.md)。PostgreSQL dump 不包含 media volume，正式上線前須另行加密備份並演練一致時間點還原。

Phase 8 公開店面 API 僅在租戶啟用後讀取目錄、品牌與上架商品圖片；各路徑以 tenant slug 和有效上架範圍再次授權，60 requests/minute 限流。production 需在可信代理正確傳遞 client IP 並評估共享快取／edge rate limit；切勿暴露未啟用租戶或未上架商品圖片。詳細規則見 [Phase 8 客戶店面安全](ecommerce-storefront-phase8.md)。

Phase 9 加入管理員維護的公開店面標題與介紹及唯讀商品詳情 dialog。文案限制長度、受租戶管理員 RBAC 與既有審計保護；公開詳情只重用已發布型錄欄位，不增加匿名寫入或個資暴露。

Phase 10 category filter 只處理啟用租戶中有效上架商品的分類文字，輸入上限 80 字；分類選項與結果沿用同一租戶範圍及既有 60/minute public throttle。
