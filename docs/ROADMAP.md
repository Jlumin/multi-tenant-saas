# Roadmap

2026-10-26 初版；里程碑依成果排序，未承諾日期。

| 階段 | 交付物 | 退出條件 | 依賴 |
| --- | --- | --- | --- |
| M0 / BOOTSTRAP-001 | Web/TypeScript 骨架、健康檢查、本機 DB、migration、CI、開發文件 | 新環境可啟動，檢查與 CI 通過 | 本文件與 AGENTS 可在工作分支讀取 |
| M1 / 待開 Issue | 登入、租戶、membership、角色與租戶 context | 兩租戶授權矩陣與資料完整性測試通過 | 選定登入供應商與租戶加入政策，M0 |
| M2 / PROJECTS-001 #9 | Project CRUD、基本 UI、稽核與 E2E | PRD MVP 驗收逐項通過 | M1；Project 首個資源已確認 |
| WMS 需求 / WMS-DISCOVERY-001 #11 | 詳細需求、流程、權限、庫存不變條件與分期提案 | 位置、整數計量與拆零需求已確認；過帳等規則仍待決定 | Project 工程；需求草案不等於完整 WMS |
| WMS-001 #13 | 商品／包裝、倉庫／儲位主檔、換算試算、授權與 UI | PostgreSQL、API、整數換算與兩租戶隔離測試通過 | 已合併需求規格 #12；PR 待審 |
| WMS-002 #15 | 庫存流水、一般入庫／出庫、Owner 過帳、禁止負庫存與基本餘額查詢 | PR #16 Draft；64 項 PostgreSQL integration、HTTP 與 CI 通過 | WMS-001 主檔；期初另開階段 |
| WMS-003 #17 | 庫存／異動查詢篩選、分頁、來源單據明細與本機端到端試用 | Draft PR #18；CI #13 通過；桌面瀏覽器人工驗收仍待補 | WMS-002；PR 以 `feat/wms-002` 為 base |
| WMS-004 #19 | 同倉儲位移轉與即時跨倉調撥 | Draft PR #20；Actions #18 全綠；即時模式仍是待確認假設，人工瀏覽器驗收待補 | WMS-003；PR 以 `feat/wms-003` 為 base |
| WMS-005 #21 | 盤點、期初、調整與沖銷 | 實作完成，Draft PR #22；CI #21–#24 通過，盤點差異／Owner-only 期初／沖銷確認介面已補齊；業務規則待人工確認 | WMS-004；PR 以 `feat/wms-004` 為 base |
| ECOM-DISCOVERY-001 #23 | 整理購物網站需求、資料邊界與分期候選 | Draft PR #24；需求與商業交易政策仍待產品確認 | Project、WMS 工程；以 `feat/wms-005` 為 base |
| ECOM-001 #25 | 租戶店面、商品目錄管理及公開商品瀏覽 | 實作與 PostgreSQL 驗證完成，Draft PR 以 `docs/ecommerce-discovery-001` 為 base；店數、幣別、權限與商品型態為暫定決策，待產品確認 | ECOM-DISCOVERY-001；不含訂單、付款、WMS 庫存整合 |
| ECOM-002 #26 | browser cart、訪客 checkout、server 價格快照、冪等防重、Owner-only 訂單檢視 | Draft PR #27 以 `feat/ecommerce-001` 為 base；本機驗證及 GitHub Actions runs #31–#32 通過；產品暫定政策與買家資料保存期限待最後確認 | ECOM-001；不含付款、稅、運費、CRM、WMS 庫存與正式營運 |
| ECOM-003 Discovery #28 | WMS 商品關聯、可售量定義、預留／釋回契約與失敗補償規格 | Draft PR #29 文件探索；Owner 已確認商品必映射、單店單一出貨倉、缺貨拒單／到貨通知、實際回庫後恢復可售 | ECOM-002、WMS-001–005；文件-only |
| ECOM-003 implementation #30 | WMS SKU mapping、單倉可售量／預留、缺貨拒單與到貨通知、跨倉調撥開關 | Draft PR #31；GitHub Actions 最新 head 全綠；等待人工驗收與 PR 審查，尚未合併 | ECOM-003 Discovery #28 / PR #29、ECOM-001/002、WMS-001–005 |
| HR-001 #32 | 租戶員工名冊、本人 server-time 上下班打卡、Owner 出勤查詢與 append-only 更正 | Draft PR #33；GitHub Actions run #40721476910 全綠；等待人工驗收與 PR 審查，尚未合併；產品假設待整體試用確認 | 使用者排列順序第 1；M1 membership／tenant boundary |
| M3 / 待開 Issue | 部署、備份還原、監控、安全與產品試用 | 部署與復原演練、上線條件審查 | 部署供應商、資料政策、M2 |

2026-10-27 進度：M0 PR #3、AUTH-001 PR #5、TENANCY-001 PR #7、PROJECTS-001 PR #10 均已提出 Draft。Project commit 96c14dc 的 GitHub Actions #6 已 success，本機45項測試與 production HTTP流程通過，並完成新增／編輯／刪除確認及取消的瀏覽器操作，見 [Project 驗證](verification/PROJECTS-001.md)。WMS-001 Draft PR #14 的 CI 已通過；WMS-002 Issue #15 已完成並提出 Draft PR #16（以 feat/wms-001 為 base），CI #11/#12 成功；Owner-only 過帳、禁止負庫存、期初庫存另開階段。WMS-003 Issue #17 已提出 Draft PR #18。WMS-004 Issue #19 已提出 Draft PR #20，Actions #17/#18 通過；即時調撥仍待產品確認且人工瀏覽器驗收未做。延後的邀請真人補驗仍追蹤 QA-001 / #8；PR 審查未完成前不宣告正式上線。

2026-10-28 使用者指定其餘模組順序為 HR → Restaurant QR 點餐／POS → CRM → E-Commerce 金流。HR-001 Issue #32 是首個切片；Restaurant、CRM、金流尚無 implementation Issue，其中金流仍待支付供應商／幣別／退款政策確認。

## 第一次交付
WMS 需求補充：使用者已確認一般商品／零件、多倉庫＋儲位（目前僅分地點）、可能拆零出貨及整數計量。規格預設每倉提供未分配儲位、每 SKU 設基本單位與整數包裝比例；細節見 WMS-REQUIREMENTS.md v0.3。WMS-001 提供主檔與換算；WMS-002 已在 Draft PR #16 提出，WMS-003 正在補齊查詢篩選與異動明細。

2026-10-26 使用者補充決定：邀請寄信人工驗證延後至整體建置完成，追蹤 QA-001 / Issue #8，不阻擋開發；實作順序為 Project 專案管理 → WMS 倉儲 → 其他業務模組。Project 作為 M2 第一個業務資源已確認；WMS 細部作業規則及其餘模組順序仍待定義。

BOOTSTRAP-001 只建立可驗證的本機與 CI 基礎，不實作完整 SaaS 或 Agent。
實作從文件分支分出；文件 PR 未合併時，實作 PR 先以文件分支為 base，以免混合差異。
文件合併後更新實作 PR base 並重新驗證；不自行合併。

## 後續拆分建議
M1 拆成身分整合、租戶建立/選取、membership/角色、隔離測試。
M2 拆成 API/service、UI、稽核、端到端測試。
M3 的正式資料與部署操作需使用者另行授權。
這些只是規劃，尚未建立對應 Issue。

## 風險
產品需求有限：所有假設須保持可辨識。
租戶隔離錯誤：先驗證兩租戶負向情境再擴充功能。
身分與部署未選：M0 避免綁定外部服務。
目前工程與測試證據見 verification/ 與各 Draft PR；文件提交不等於產品驗收或正式上線。
