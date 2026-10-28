# ECOM-004A 付款帳本驗證

日期：2026-10-29。對應 Issue #40。此切片只建立供應商中立的內部付款帳本，不接外部服務、不收款、不處理退款、不改訂單狀態或 WMS reservation。

| 檢查 | 結果 | 證據 |
| --- | --- | --- |
| Prisma format / validate / generate | PASS | 新增 Prisma payment enums/models，client 重新產生，schema valid。 |
| ESLint | PASS | ESLint `--max-warnings 0`。 |
| TypeScript | PASS | Next.js route typegen 及 `tsc --noEmit`。 |
| Unit tests | PASS | 3 個檔案／10 項。 |
| PostgreSQL integration | PASS | 9 個檔案／95 項；包括 Owner-only attempt、tenant isolation、金額／幣別快照、重複事件、終止後遲到 processing、終止狀態衝突、append-only guards 及 audit rollback。 |
| Database smoke | PASS | Fresh disposable PostgreSQL，19 個 migration、付款帳本表存在、第二次 deploy 不變、schema drift 為空；測試資料庫已移除。 |
| `git diff --check` | PASS | 無 whitespace errors。 |
| Production build / HTTP smoke | NOT RUN LOCALLY | 使用者的開發伺服器共用本 checkout 的 `.next`；本機 build 可能中斷伺服器。PR GitHub Actions 將驗證 clean CI build 與 HTTP smoke。 |
| 人工瀏覽器付款流程 | NOT APPLICABLE | 尚無公開付款入口或供應商，符合此 Issue 的明確範圍。 |

狀態服務只接受已由未來供應商 adapter 驗簽後轉換的 normalized event；本 PR 尚未實作 adapter 或 webhook route。付款成功不改 `ecom_orders.status`，不觸發出貨、履約或庫存釋回。商戶地區、供應商、幣別／方法、期限、退款、對帳與稅務政策保留待使用者後續設定。
