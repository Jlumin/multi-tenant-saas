# PROJECTS-001 驗證報告

2026-10-26，Asia/Taipei。Issue #9，feat/projects-001，自 TENANCY-001 的 2d76ac1 接續。使用者確認先做 Project，再整理 WMS 詳細需求，最後其他模組。邀請寄信的真人補驗延後，追蹤 QA-001 / #8。

## 範圍

Project 租戶內 CRUD、分頁、Owner/Member 授權、version 衝突、soft delete、metadata 審計與最小 UI。第四份 migration 新增 projects，既有 README 與三份 migration 無修改，無新 npm 依賴。

## 本機自動化

Linux Docker，Node 24.22.1 / npm 11.19.1 / PostgreSQL 17.11 / Mailpit 1.32.0。驗證在獨立程式副本執行，測試用隨機 PostgreSQL DB，沒有使用正式 Google 憑證或對使用者的租戶作 API 測試。

| 項目 | 結果 |
| --- | --- |
| npm ci | 更新本機開發容器時乾淨安裝成功，lockfile 與依賴未變 |
| npm run db:generate | Prisma Client 成功產生 |
| npm run lint | 通過，0 warnings |
| npm run typecheck | 通過，含 Next route types |
| npm test | 10/10 通過 |
| npm run db:validate | schema valid |
| npm run db:smoke | 四份 migration、空庫套用、重複套用不變、schema diff 無差異、原欄位／約束皆通過 |
| npm run test:auth | 35/35 通過：9 auth、15 tenancy、11 projects |
| npm run test:http -- --dev | dev 首頁／health 200、no-store、POST health405 通過 |
| npm run build | production build、TypeScript、route generation 通過 |
| npm run test:http | production 首頁／health 同上通過 |
| npm run test:auth:http | 真實 production HTTP + PostgreSQL + SMTP/Mailpit，原身分／邀請流程與 Project CRUD、version409、Member delete403、兩租戶404、Owner soft delete、登出通過 |
| 清理／原檔 | 測試庫無遺留；README 與前三份 migration 無 diff；.env 仍 Git ignored |

首輪 typecheck 發現測試中異質 header array 的推導類型含 undefined，改為明確 Record<string,string>[] 後重跑以上 lint/typecheck 及後續檢查成功；沒有跳過檢查。

Project PostgreSQL 測試使用真實 Better Auth signed session。涵蓋匿名與偽造 header、兩租戶所有 CRUD、其他租戶資源 ID、未加入者、Member 新增／修改但禁止刪除、createdBy server 指定、白名單欄位、字數／版本／JSON／Origin／路徑／分頁、分頁無重複、soft delete 不再可讀寫與不能 DB 復活、並發更新只有一次成功、撤權／停用租戶／取消驗證、歷史 membership 保留、複合 FK、DB 名稱與版本檢查、身份不可移動，以及 create/update/delete 的 audit 失敗 rollback。

## 本機瀏覽器

沿用操作者已登入的 Google session，在「開發測試公司」驗證 /projects：選工作空間、空列表、新增虛構專案、列表與單筆可見、編輯後版本由1至2、Owner 刪除確認提示及取消，全部成功。保留「Project 功能驗證範例」供使用者試用，沒有真正客戶資料。

查 DB 確認 project.created、project.updated 各一筆審計。實際刪除已由獨立 HTTP 與 PostgreSQL 測試驗證，瀏覽器沒有確認刪除留下的人工試用範例。未執行完整自動化瀏覽器 E2E 或大量資料視覺／效能測試。

本機開發 DB 已套用第四份 migration，migrate status up to date；原有 Google 帳號、session、租戶保留，沒有 reset 或移除 PostgreSQL volume。服務只綁本機 localhost:3000。

## 限制與交付

遠端 CI 以本 PR 實際 run 結果為準，不把本機通過當成 GitHub success。依賴 #7/#5/#3/#2；文件分支未合併時以文件分支為 base，保持 Draft，不推 main、不合併、不部署。

刪除保留資料，無自行還原或永久清除。名稱可重複；沒有任務／排程／附件／搜尋／RLS。租戶寫入序列化，吞吐需之後評估。UI 的工作空間載入上限仍100，Project 分頁每頁10且 API limit最多100。正式 SMTP、Google 其餘人工情境、留存與上線未驗收；WMS 先整理需求，不在本 Issue 實作。
