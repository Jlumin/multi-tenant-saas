# WMS Phase 2 架構與操作規則

狀態：Phase 2 第一版已在 SME Cloud Django/DRF + PostgreSQL + Angular 專案實作。需求依使用者先前確認：一般商品／零件、多倉與儲位、商品可拆零、數量採整數、只有租戶管理員可過帳、出庫不得形成負庫存；期初庫存另階段處理。

## 模組邊界

`modules.wms` 擁有商品、包裝單位、倉庫、儲位、庫存餘額、入出庫單據、庫存異動與 Phase 3 預留分配。WMS 資料以租戶為界；目前沒有將倉庫綁定 platform Store。WMS 使用 platform tenant、membership 與 audit 服務；E-Commerce 只透過 `modules.wms.application` 公開合約要求檢查商品、查可售量、預留／釋放／扣用，不能直接寫 WMS 表。

## 角色

| 平台角色 | WMS 能力 |
|---|---|
| admin（租戶 Owner） | 維護商品／包裝／倉庫／儲位；建立、編輯、取消草稿；過帳；查詢庫存及異動 |
| manager | 查詢主檔、庫存、異動；建立、編輯、取消入出庫草稿；不可過帳或管理主檔 |
| viewer | 唯讀查詢；不能建立、編輯、取消或過帳 |

所有 endpoint 每次重新檢查已驗證 session、active membership 與 tenant scope。URL tenant UUID 是選擇器；request body 不接受 tenant、操作者或 posting actor 等欄位。

## 資料規則

- 商品 SKU、倉庫代碼在同一租戶唯一；儲位代碼在同一倉庫唯一。代碼由 API trim 並轉 ASCII 大寫。
- 商品建立時自動產生 `BASE` 基本單位。另可建立如「箱」等包裝單位，`base_quantity` 為每包對應基本單位數，限正整數 1–1,000,000。
- 每倉建立時自動產生不可停用的 `UNASSIGNED`／未分配儲位；之後可新增實體儲位。商品、包裝、倉庫與儲位不硬刪除。
- 單據草稿保存包裝數量、基本單位換算比例及換算後的整數數量快照。過帳後單據和明細不可修改／刪除。
- 管理員以一筆交易過帳整張單據；入庫增加、出庫減少餘額並為每一明細新增一筆 append-only movement 和 metadata audit。任一檢查失敗全部 rollback。
- 單一租戶的過帳會鎖定 Tenant row，序列化同租戶庫存異動，包括尚未存在的餘額列，防止併發超賣。出庫量超過該商品／倉庫／儲位餘額時拒絕整單，餘額保持不變。
- 建單使用 tenant-scoped idempotency UUID，同 key 同 payload 回傳既有單據；同 key 不同 payload 回 409。重複過帳不新增 movement。
- 停用有正庫存、未結草稿關聯的商品／倉庫／儲位會被拒絕；基本單位與預設未分配儲位不能停用。

## API

前綴 `/api/v1/tenants/{tenant_id}/wms/`；列表採平台的 bounded limit/offset pagination。

| 方法／路徑 | 說明 |
|---|---|
| GET/POST `products/` | 商品查詢／admin 新增 |
| GET/PATCH `products/{product_id}/` | 商品查詢／更新名稱、啟停（需 version） |
| GET/POST `products/{product_id}/units/` | 包裝查詢／admin 新增整數換算 |
| GET/POST `warehouses/` | 倉庫查詢／admin 新增（同交易建預設儲位） |
| GET/PATCH `warehouses/{warehouse_id}/` | 倉庫與儲位查詢／admin 更新 |
| GET/POST `warehouses/{warehouse_id}/locations/` | 儲位查詢／admin 新增 |
| PATCH `locations/{location_id}/` | admin 更新儲位名稱與狀態 |
| GET/POST `documents/` | 單據查詢／管理員或 manager 建立入出庫草稿 |
| GET/PATCH `documents/{document_id}/` | 單據明細／以 version 更新草稿明細 |
| POST `documents/{document_id}/post/` | admin 原子過帳 |
| POST `documents/{document_id}/cancel/` | admin 或 manager 取消草稿 |
| GET `balances/` | 正庫存餘額，支援 product_id／warehouse_id／location_id 篩選 |
| GET `movements/` | 唯讀流水，支援同一組篩選 |

所有 mutation 使用同源 session 與 CSRF；WMS 不提供匿名 endpoint。拒絕錯誤回傳平台統一 error/request ID 格式。

## 未包含

本 WMS Phase 2 切片沒有期初庫存、調撥、同倉移位、盤點／調整／沖銷、批號效期／序號、採購單、倉庫到 Store 的映射、批次匯入或正式部署。Phase 3 另新增 E-Commerce reservation contract，但尚未提供公開購物網站。期初庫存按使用者決定另階段實作；這些邊界不能解讀為功能已通過營運驗收。

