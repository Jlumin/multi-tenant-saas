# WMS Phase 2 PostgreSQL schema

Migration：`modules.wms.0001_initial` 與 `0002_database_guards`。兩個 migration 僅新增 WMS tables 與 PostgreSQL triggers，不變更 platform_core 或 Phase 0 auth/session schema。

| Table | 用途與關鍵保護 |
|---|---|
| `wms_product` | 租戶 SKU 與整數基本單位；tenant/code unique，tenant 不可改掛 |
| `wms_packageunit` | 商品包裝與基本單位換算；商品/code unique、正整數比例、唯一 BASE，tenant/product/換算身份不可改 |
| `wms_warehouse` | 租戶倉庫，tenant/code unique；建立時服務同交易建立預設儲位 |
| `wms_location` | 倉庫儲位，warehouse/code unique，每倉最多一個 default；tenant/warehouse/code/default 身份不可改，不能刪除 |
| `wms_inventorydocument` | 入庫／出庫草稿、冪等 key、版本及建立／過帳 membership；tenant/document_code 與 tenant/idempotency_key unique |
| `wms_inventorydocumentline` | 整數包裝數量、比例及基本單位快照；DB trigger 驗證同 tenant、所屬商品與倉庫／儲位及換算乘積 |
| `wms_stockbalance` | tenant/product/warehouse/location 唯一餘額；CHECK quantity >= 0、trigger 驗同租戶關聯並只准 posting transaction 寫入 |
| `wms_stockmovement` | 每明細單筆的有符號基本單位異動；OneToOne line、DB trigger 驗證文件類型／數量／租戶，UPDATE/DELETE 禁止 |

`0002_database_guards` 另限制文件在 posted/canceled 後不可更新或刪除，並以 deferred constraint trigger 保證提交時每一 posted 明細都有相符 movement 和操作者／時間。default location、BASE unit、已存在的關聯身份有 DB 保護，因此 bulk ORM/SQL 也不能跨租戶掛接。

庫存過帳服務在 `transaction.atomic()` 內鎖 tenant row；變更餘額只在交易內設定本地 `wms.allow_balance_write`，再由 balance trigger 接受。此機制防止一般 ORM 誤寫，但資料庫 owner/superuser 可停用 trigger 或自行設定 session GUC；正式環境仍需 migration/runtime DB role 分權與外部稽核備存。未啟用 RLS，不宣稱任意 SQL 自動具 tenant isolation。

在隔離 PostgreSQL 執行：

```powershell
docker compose --env-file .env.example up -d db
docker compose --env-file .env.example run --rm backend python manage.py check
docker compose --env-file .env.example run --rm backend python manage.py makemigrations --check --dry-run
docker compose --env-file .env.example run --rm backend python manage.py migrate --noinput
docker compose --env-file .env.example run --rm backend python manage.py test modules.wms
```

既有資料庫不可使用 `migrate zero` 或 reset；新增 migration 前應依環境政策先備份。測試建立獨立 test database 並在完成後銷毀。

