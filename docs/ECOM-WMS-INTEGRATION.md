# E-Commerce × WMS 整合探索

狀態：ECOM-003 Discovery / Issue #28。此文件用來定義契約候選與產品決策，不代表已核定庫存政策或已實作整合。日期：2026-10-28。

## 目前實作事實

- ECOM-001 的 `EcomProduct` 擁有買家可見商品、代碼及售價；目前沒有 WMS SKU 關聯。
- ECOM-002 的訪客訂單狀態為 `submitted`，建立後的訂單與明細快照不可變；沒有取消、付款、履約或庫存預留狀態。
- WMS 擁有 `WmsProduct`、倉庫、儲位、餘額與不可變 movements。餘額以商品基本單位的整數數量按倉庫／儲位保存。
- 現有 WMS balances service 是登入 membership 保護的查詢；過帳由 WMS service 按 Owner 權限、交易鎖、冪等與不可負庫存處理。
- WMS 目前沒有 reservation／available quantity service。`balance.quantity` 代表帳上現有量，不能視為已扣除預留量的可售保證。
- ECOM 與 WMS 必須透過擁有方的 public service/contract；E-Commerce 不直接查／更新 WMS 表格，WMS 不直接寫 E-Commerce 訂單。

詳細實作以 `src/server/ecommerce/orders.ts`、`src/server/wms/stock-service.ts`、Prisma schema 與 WMS ADR 0006 為準。

## 模組契約候選

### 商品關聯

建議使用明確的 WMS product ID 關聯，不以可變更的 SKU 字串即時猜測對應。此 ID 是跨模組 reference，E-Commerce 不建立跨模組 FK，也不擁有 WMS product 的名稱、基本單位或啟用狀態。Owner 綁定時由 WMS service 驗證商品屬於同一 tenant 且可用；每次查量／預留仍重新驗證。解除映射與 WMS 商品停用後，既有 E-Commerce 訂單的名稱、代碼與數量快照仍須可讀。

此為提案，須確認 E-Commerce 商品是否都要連 WMS SKU，或允許不追蹤庫存的服務／虛擬商品。

### 倉庫與可售量

多倉總量不能自動等同店面可售量。店面需指定可供線上訂單使用的倉庫集合，並決定同一商品是否可跨倉合計。儲位以 WMS 為準；未分配儲位是否納入線上銷售也需明確設定。

候選定義：

- `on hand`：符合店面供貨倉／儲位條件的 WMS 正庫存總和。
- `reserved`：仍有效且尚未釋回／履約的 WMS 預留量。
- `available = on hand - reserved`：只有 WMS reservation service 存在且同一庫存交易中一致維護時，才可作為承諾可售量。
- 若只有讀取 WMS balances，頁面最多標示「查詢時帳面量」或「目前有量」；查詢與送單之間可能被其他作業出庫，不能保證結帳成功。

所有數量以 WMS 基本單位整數計算。E-Commerce 顯示包裝方式不能改寫 WMS 換算比例或庫存單位。

### 預留與訂單狀態

預留至少需有租戶、商品、倉庫／儲位分配、整數基本量、來源訂單 reference、狀態、過期時間、冪等鍵及 metadata audit。建立／釋回／履約扣減由 WMS service 擁有。相同 key／相同內容重送回同結果，不同內容衝突；餘額鎖定順序固定，併發不得超額預留。

建議的服務介面只描述責任，不是已核定 API：`reserve(tenant, orderRef, lines, idempotencyKey, expiresAt)`、`release(tenant, reservationRef, reason, idempotencyKey)`、`fulfill(tenant, reservationRef, quantities, idempotencyKey)`。呼叫端不能傳入可任意切換的 tenant；服務從已驗證 session／交易上下文取得租戶，匿名 checkout orchestration 只能使用伺服器建立的可信 tenant/store context。各命令須驗證同租戶商品、供貨倉與有效狀態。錯誤至少區分 `insufficient_stock`、`product_unavailable`、`reservation_expired`、`idempotency_conflict` 及可重試的儲存／暫時失敗；對外回應不得洩露其他租戶商品或庫存是否存在。

EcomOrder 目前建立後固定 `submitted` 且不可更新。若要預留，還需定義例如「訂單已預留」「待付款」「付款失敗」「取消／逾時已釋回」「履約扣帳」等狀態與允許的狀態轉移。不能只有預留 TTL 而沒有到期工作、訂單同步、重試及審計；也不能在沒有取消／逾時流程時永久占住庫存。

### 原子性與失敗補償

在目前同一 PostgreSQL modular monolith 中，候選作法是由 E-Commerce checkout orchestration 呼叫 WMS 公開 reservation contract，讓 WMS 自己寫 reservation/stock 資料，並在共享交易中提交訂單 reference、預留及 audit。契約可接受呼叫端的 transaction abstraction，但不得讓 E-Commerce service 自行寫 WMS model。

若未來跨服務／非同步化，需改用 outbox／可重試命令及明確補償：例如預留成功、訂單提交失敗時釋回；釋回失敗保留可重試事件與可查狀態，不能吞錯或直接改餘額。選同步共享交易或非同步補償須在實作 Issue 核定，不宣稱兩者等價。

## 建議拆分

1. **ECOM-003 Discovery（Issue #28，本分支）**：確認商品映射、供貨倉／儲位、可售量、預留時機、狀態、到期與補償政策；本階段只交文件。
2. **ECOM-003 implementation（後續 Issue）**：依產品答案拆成最小切片。若只要資訊，可先做穩定 SKU reference 與非保證性的帳面量查詢；若必須防超賣，須同時交付 WMS-owned reservation service、訂單生命週期／釋回、冪等與併發測試，不能只加一個庫存數字。
3. 支付／CRM／物流仍各自獨立排期；支付狀態未實作前，不得假設付款成功才扣帳或以付款逾時釋回。

### 下一張 implementation Issue 草案（尚未開立）

**候選標題：ECOM-003：WMS SKU 映射與訂單庫存履約契約**。實作前需以產品決策固定：映射／非庫存商品、店面供貨倉、reservation 是否必要及建立時點、保留期限、缺貨與部分出貨、取消／逾時釋回，以及失敗補償。若第一個實作切片只做提示性帳面量，Issue 必須明確禁止將其用於結帳保證；若要防超賣，範圍須同時包含 WMS-owned reservation/release、訂單狀態轉移與釋回工作，不能拆成只有讀取數量的半套保證。

完成決策後，實作 Issue 驗收至少包括：同租戶商品映射與停用驗證；跨租戶映射拒絕；店面供貨倉／儲位範圍；Owner/Member/匿名權限；available 不得低於零；兩個同時訂單競爭最後庫存只允許一方成功；同 key 同內容重播不重複占量、不同內容回衝突；取消／到期／付款失敗釋回冪等；建立訂單或 audit 失敗時完整回滾或持久化可重試補償；跨倉拆分遵守已核定規則；歷史訂單快照不受商品改名／解除映射影響。

### Discovery 驗收情境

| 情境 | 本文件的規格結論 |
|---|---|
| Owner 綁定其他租戶的 WMS 商品 | WMS service 必須拒絕；不可只靠客戶端傳入 tenant ID 或商品 UUID。 |
| Member 或匿名訪客讀取 WMS balance | 已登入且具同租戶 membership 的 Member 依現行 WMS 授權可查租戶餘額；匿名公開店面不得直接呼叫 WMS balance service。若店面公開數量，必須經 E-Commerce 契約回傳核定的最少資訊且不能宣稱已預留。 |
| 店面 A 與 B 使用不同供貨倉 | 各自套用店面核定的倉庫集合，不能因同租戶而混加或互相占用。 |
| 同一商品在多倉／儲位且部分未配置儲位 | 只有產品選定的 eligible warehouse/location 可納入；未知範圍不做隱式合計。 |
| 兩筆訂單同時爭用不足庫存 | balance read 不具防超賣能力；reservation service 必須序列化／鎖定並讓競爭結果符合不足庫存政策。 |
| 同一 reservation 命令重送 | 同 idempotency key、同規範化內容回傳既有結果；同 key 不同內容回衝突。 |
| reservation 成功、訂單或 audit 隨後失敗 | 同 PostgreSQL 交易則全部回滾；若跨交易／非同步，必須記錄可重試補償，不可靜默吞掉或手改餘額。 |
| 取消、付款失敗、逾時及部分履約 | 需由核定的訂單狀態轉移觸發冪等 release/fulfill；目前 ECOM-002 沒有這些狀態，因此不能啟用 reservation。 |
| 商品停用、解除映射或價格改名 | 新單依當下映射與可用性驗證；既有訂單保留建立時不可變快照與原始 WMS reference。 |

## 需產品最後確認

1. E-Commerce 商品要不要全部映射 WMS SKU？是否有不追蹤庫存商品？
2. 每間店可從哪些倉出貨？庫存可跨倉合計嗎？未分配儲位是否可售？
3. 先接受只顯示帳面量、允許人工處理缺貨，或必須先支援預留避免超賣？
4. 若預留：在送出訂單、人工確認或付款成功哪個時點建立？預留多久？
5. 庫存不足時拒絕下單，還是允許待確認／部分供貨？是否支援部分出貨或跨倉拆單？
6. 取消、付款失敗／逾時、店家拒單與預留到期時，何時釋回；釋回失敗怎麼人工處理？
7. 是否先完成 E-Commerce 訂單狀態與取消／到期工作，再開始 reservation implementation？

PR #29 為本探索文件的 Draft PR；Issue #28 保持 open，直到產品決策與 implementation issue 完成拆分。
