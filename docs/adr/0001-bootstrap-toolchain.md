# ADR 0001：BOOTSTRAP-001 工具鏈與邊界

日期：2026-10-26。狀態：本 Issue 實作決策，產品與後續架構仍待確認。

## 決策

- Node 24.22.1（.nvmrc）、npm 11.19.1（packageManager），engines 限定 Node 24 / npm 11；CI 使用相同 patch。
- Next.js 16.4.3 App Router、React/React DOM 19.3.1，採受支援的 Next 16 stable 線，非 canary。
- TypeScript 5.9.3、ESLint 10.13.0、typescript-eslint 8.72.0 與 @next/eslint-plugin-next 16.4.3；lint 獨立執行，不假設 build 會執行 lint。ESLint 9 已停止支援，而 eslint-config-next 的 React plugin 尚未宣告支援 ESLint 10，因此直接組合官方 Next plugin 與 TypeScript/JS recommended rules，不使用 --force 或忽略 peer dependencies。M0 沒有 client hooks；後續加入互動元件時再評估 React hooks/accessibility lint。
- Vitest 5.0.5 在 Node 環境直接驗證 route handler；額外 HTTP smoke 啟動真正 Next dev/start，驗證路由與首頁。
- Prisma 7.10.1 CLI 管理 schema/migrations；Prisma 8 尚是 RC，不採預發版本。沒有業務資料讀取，故不加入 Prisma Client 或登入 SDK，避免未授權租戶查詢介面。
- PostgreSQL 17.11，以固定 image digest 供本機及 CI 使用。pg 8.23.1 僅供測試直接驗證資料庫欄位與約束。dotenv 明確載入本機 .env，CLI 缺少設定會失敗，不給隱藏遠端 URL。
- 所有直接依賴使用精確版本，傳遞依賴由 package-lock.json 固定；GitHub Actions 亦固定 commit SHA。升級需另外驗證與更新鎖檔。

## 影響

GET /api/health 為公開 liveness，只回 `{ "status": "ok" }`，不連 DB、不包含環境或秘密。資料庫 readiness 由獨立 smoke test 驗證，不能由 liveness 推論。沒有 tenant CRUD、假登入、membership、RLS 或跨租戶管理權限。

原 AGENTS 要求的兩租戶與非成員「授權」測試屬 M1；本 Issue 明確排除身分／授權，不以假驗證實作取代。DB smoke 建立兩筆虛構租戶作完整性驗證，沒有開放讀寫租戶的 endpoint，也不宣稱已具租戶隔離。

## 依據

- [Next.js 安裝需求](https://nextjs.org/docs/app/getting-started/installation)
- [Next.js 支援政策](https://nextjs.org/support-policy)
- [Prisma 7 config](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)
- [Prisma 版本狀態](https://www.prisma.io/docs/orm/release-status)

版本另以 npm registry 實際 metadata 查核；執行結果見 BOOTSTRAP-001 驗證報告。無偏離 Issue 的技術預設。
