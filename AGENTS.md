# GPT PM + Codex 工作規範

## 適用範圍與事實
適用於整個儲存庫。2026-10-26 基線只有 README.md，尚無應用程式、套件或 CI。
產品需求與技術方案見 docs/；標為「提案」的內容不是已實作能力。
保留既有檔案與使用者改動；本次文件建立不可覆寫 README.md。

## 分工
- 使用者：產品目標、商業規則、重大取捨、上線與合併的最終決策。
- GPT PM：整理需求、範圍、依賴、Issue、驗收條件，審查成果是否符合需求；不得把推測寫成已核定需求。
- Codex：先讀本檔、相關文件與 Issue，實作、測試、提出 PR 與證據。遇到矛盾先指出來源；能獨立完成的工作繼續進行。
- 只有使用者明確授權時才啟用額外代理或平行代理工作。

## 工作流程
1. 讀取最新分支與 Issue，確認現況、依賴和驗收條件。提出精簡實作方案。
2. 每個 Issue 使用獨立 feature branch，禁止直接推送 main、強制推送、合併或部署，除非使用者另行授權。
3. 只改 Issue 範圍；新增依賴須說明用途，提交 lockfile。不可提交秘密、真實客戶資料或 .env。
4. 寫入或更新檔案前先讀現有內容；保留無關改動。刪除、不可逆 migration、正式資料操作需另外授權。
5. 完成必要測試與文件；PR 列出變更、Issue、驗證結果、風險與未完成項目。未執行的測試須明說原因。
6. GPT PM 對照驗收條件審查，使用者決定是否合併。文件與 Issue 的提出不等於功能已交付。

## 多租戶實作底線
租戶範圍由已驗證身分與有效 membership 決定，不能信任客戶端提供的 tenant_id。
所有租戶資料讀寫都必須做租戶與角色驗證，涵蓋列表、單筆、更新、刪除、背景任務及匯出。
不得以「UUID 很難猜」代替授權。測試至少兩個租戶與非成員拒絕情境。
記錄可稽核事件但不記錄 token、密碼、連線字串或個資內容。

## 驗證指令
目前尚未建立工具鏈，不能宣稱存在可執行指令。
BOOTSTRAP-001 必須建立並記錄 install、dev、lint、typecheck、test、build 與本機資料庫操作指令。
後續執行者以當時 package.json、lockfile 與 CI 為準，不可猜測或偽造通過結果。

## 完成定義
驗收條件逐項有證據；必要測試通過；新手可按文件啟動；沒有秘密、無關修改或未說明限制；PR 可供人工審查。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
