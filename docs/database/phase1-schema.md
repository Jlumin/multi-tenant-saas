# Phase 1 schema 與 migration

新增 `platform_core.0001_initial`、`0002_database_guards`，相依現有 Django User。不重設 Phase 0 auth/session tables，也不建立五個業務模組表。

| 表 | 主要欄位與約束 |
|---|---|
| platform_core_tenant | UUID PK、name、unique slug、is_active、created_at |
| platform_core_store | UUID PK、tenant FK PROTECT、name/code/is_active、unique(tenant,code) |
| platform_core_membership | UUID PK、tenant FK、User FK PROTECT、role、is_active、unique(tenant,user)、role check |
| platform_core_storeaccess | membership/store FK、unique(membership,store) |
| platform_core_auditevent | UUID PK、nullable tenant/actor FK PROTECT、action/target_id/request_id/created_at、tenant+time index |

User 為全域身分，StoreAccess 透過 Membership/Store 關聯租戶，不重複保存 tenant_id。PostgreSQL trigger 檢查 StoreAccess 的兩端為同租戶，即使 bulk_create 也不能跨租戶；Store/Membership 的 tenant_id 建立後禁止變更。AuditEvent 的 UPDATE/DELETE 由 trigger 拒絕，應用層也禁止 model 更新／刪除。

資料庫 superuser／owner 可停用 trigger、TRUNCATE 或修改 schema，因此不是防 DBA 竄改機制。開發 Compose 帳號仍有 owner 權限；正式環境要分 migration owner / runtime role，限制 DDL/TRUNCATE，另規劃外部審計備存。尚未啟用 PostgreSQL RLS；隔離依應用查詢 scope 與上述關聯約束，不能宣稱任意 SQL 都隔離。

套用與驗證：

```powershell
docker --config .docker-local compose --env-file .env.example exec -T backend python manage.py migrate --noinput
docker --config .docker-local compose --env-file .env.example exec -T backend python manage.py makemigrations --check --dry-run
docker --config .docker-local compose --env-file .env.example exec -T backend python manage.py test
```

Test runner 使用獨立 test_sme_cloud database，測試後銷毀，正式開發 volume 保留。TransactionTestCase 驗證並發降權與實際 HTTP session。正式 migration 前須先做 pg_dump 與還原演練；migration rollback 雖有 reverse SQL，但回退到 zero 會刪除平台資料，不可對有用資料直接執行。
