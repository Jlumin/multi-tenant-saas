# RESTAURANT-001 驗證紀錄

狀態：實作完成；本機測試與 PostgreSQL smoke 通過。Draft PR／GitHub CI 結果待提交後補記。

## 功能切片

- Owner 餐廳、分類、菜單項目、桌位 QR 管理；Owner／Member 同租戶 POS 訂單與狀態轉換。
- 訪客 QR 菜單與送單、冪等、價格快照；PostgreSQL migration、資料庫約束與 tenant audit。
- 外部界面與假設見 [Restaurant 需求](../RESTAURANT-REQUIREMENTS.md)。

## 驗證結果

| 檢查 | 結果 |
| --- | --- |
| Prisma format / validate / generate | 通過 |
| TypeScript (`next typegen` + `tsc --noEmit`) / ESLint | 通過 |
| Vitest unit | 3 files / 10 tests 通過 |
| Vitest Restaurant PostgreSQL | 5 tests 通過：兩租戶與角色、QR digest、價格快照、冪等與併發重送、POS 狀態、immutable snapshot、audit rollback |
| 全部 PostgreSQL integration tests | 8 files / 89 tests 通過 |
| Migration deploy / drift / repeated deploy (`db:smoke`) | 通過：全新 disposable PostgreSQL DB，17 migrations，Restaurant 6 tables，第二次 deploy 不變、schema drift 為空；DB 已移除 |
| Docker Compose config / `git diff --check` | 通過 |
| HTTP smoke / production build / GitHub Actions | 待推送分支後由 CI 驗證；本機未跑 build，避免觸碰使用者正在使用的 `.next` 開發伺服器 |

