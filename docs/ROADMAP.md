# Roadmap

2026-10-26 初版；里程碑依成果排序，未承諾日期。

| 階段 | 交付物 | 退出條件 | 依賴 |
| --- | --- | --- | --- |
| M0 / BOOTSTRAP-001 | Web/TypeScript 骨架、健康檢查、本機 DB、migration、CI、開發文件 | 新環境可啟動，檢查與 CI 通過 | 本文件與 AGENTS 可在工作分支讀取 |
| M1 / 待開 Issue | 登入、租戶、membership、角色與租戶 context | 兩租戶授權矩陣與資料完整性測試通過 | 選定登入供應商與租戶加入政策，M0 |
| M2 / PROJECTS-001 #9 | Project CRUD、基本 UI、稽核與 E2E | PRD MVP 驗收逐項通過 | M1；Project 首個資源已確認 |
| WMS 需求 / WMS-DISCOVERY-001 #11 | 詳細需求、流程、權限、庫存不變條件與分期提案 | 使用者確認位置、計量與過帳等規則 | Project 工程；需求草案不等於 WMS 實作 |
| M3 / 待開 Issue | 部署、備份還原、監控、安全與產品試用 | 部署與復原演練、上線條件審查 | 部署供應商、資料政策、M2 |

2026-10-26 進度：M0 PR #3、AUTH-001 PR #5、TENANCY-001 PR #7、PROJECTS-001 PR #10 均已提出 Draft。Project commit 96c14dc 的 GitHub Actions #6 已 success，本機45項測試與 production HTTP流程通過，並完成新增／編輯／刪除確認及取消的瀏覽器操作，見 [Project 驗證](verification/PROJECTS-001.md)。接續依使用者指示先整理 [WMS 需求](WMS-REQUIREMENTS.md)，一般商品／零件已確認，其餘規則區分提案與待決策。Google 其餘人工情境、延後的邀請補驗及 PR 審查仍待完成，不宣告正式上線或所有人工驗收完成。

## 第一次交付
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
