# E-Commerce × WMS 整合探索

狀態：ECOM-003 Discovery #28 的決策已確認；implementation Issue #30 正在 `feat/ecommerce-003-inventory` 實作。下方舊版探索紀錄保留作決策來源，最新行為見「ECOM-003 實作」及驗證報告。

## ECOM-003 實作

- 每店選一個同租戶 WMS 出貨倉；E-Commerce 商品必須映射一個同租戶有效 WMS SKU。跨倉調撥由 Owner 設定，預設關閉；庫存不跨倉加總。
- WMS service contract 維護可售量及訂單 reservation。Checkout 在同一 PostgreSQL transaction 中建立 immutable order snapshot 並預留整數基本單位；同租戶鎖序列化 checkout 與 WMS 過帳，避免最後一件超賣。
- WMS Owner 確認已出貨後，WMS contract 建立 outbound posting 並同交易履約預留。釋放 reservation 須 Owner 確認實物已回倉；釋放不增加 on-hand，須另完成 WMS inbound/return 過帳才重新可售。不使用自動 TTL。
- 缺貨商品提供明確 opt-in email 訂閱。WMS inbound/opening 過帳後若指定店倉可售量轉正，通知服務寄信；失敗保留 active 訂閱，下次到貨事件可重試；信件提供互動式退訂。SMTP 使用既有 adapter，正式送信仍未驗收。
- Ecom 訂單快照不變；履約／釋回以 WMS 狀態及 append-only tenant audit 表示。跨模組讀寫經 public service contract，不設 WMS/E-Commerce 交叉外鍵。

## Discovery 時的實作事實

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

**已確認：每件 E-Commerce 商品都必須對應一個 WMS product。** 關聯以同租戶 WMS product ID 為準；不提供無庫存／虛擬商品例外。關聯仍由 WMS service 驗證，不新增跨模組外鍵。

### 倉庫與可售量

**已確認：每間店預設指定個別出貨倉，不互相調貨；系統需有開關允許互相調貨。** 初始政策只計算指定倉的可售量，不能把其他倉庫數量自動加總。開關預設關閉；啟用後仍透過 WMS transfer service 過帳，不能由 E-Commerce 改寫餘額。開關開啟後是「可調撥」還是「可由其他倉直接出貨」，須在介面與實作 Issue 中明確分開，不能默認自動搬貨。

儲位以 WMS 為準；未分配儲位是否納入線上銷售尚未確認。缺貨時公開頁顯示缺貨、禁止 checkout；顧客可主動留下 email，要求商品到貨時通知。

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

**已確認：缺貨不接受下單；到貨通知採顧客主動登記。訂單取消、付款／處理失敗或其他已占用庫存的情況，不可單靠改 E-Commerce 可售數重新上架；需待商品實際回到倉庫，完成 WMS 入庫／退回過帳後才恢復可售。** 因此 reservation release、實際回倉入庫與 fulfillment 必須分開建模；未付款／未出貨時如何解除 reservation、已出貨退回如何記錄，實作 Issue 需遵守上述「實際可售量以 WMS 過帳為準」原則並明訂狀態轉移。

### 原子性與失敗補償

在目前同一 PostgreSQL modular monolith 中，候選作法是由 E-Commerce checkout orchestration 呼叫 WMS 公開 reservation contract，讓 WMS 自己寫 reservation/stock 資料，並在共享交易中提交訂單 reference、預留及 audit。契約可接受呼叫端的 transaction abstraction，但不得讓 E-Commerce service 自行寫 WMS model。

若未來跨服務／非同步化，需改用 outbox／可重試命令及明確補償：例如預留成功、訂單提交失敗時釋回；釋回失敗保留可重試事件與可查狀態，不能吞錯或直接改餘額。選同步共享交易或非同步補償須在實作 Issue 核定，不宣稱兩者等價。

## 建議拆分

1. **ECOM-003 Discovery（Issue #28）**：文件整理完成；商品必須映射 WMS SKU、單店指定出貨倉、缺貨拒單及到貨通知意願、實際回倉過帳後才恢復可售已確認。
2. **ECOM-003 implementation（後續 Issue）**：建立同租戶 SKU reference、店面供貨倉設定、WMS-owned reservation/availability 契約、缺貨拒單及可切換的 WMS 跨倉調撥能力；不能只加非保證性的 balance read。實際回倉以 WMS inbound/return 過帳為唯一庫存增加來源。
3. 支付／CRM／物流仍各自獨立排期；支付狀態未實作前，不得假設付款成功才扣帳或以付款逾時釋回。

### 下一張 implementation Issue 草案（尚未開立）

**候選標題：ECOM-003：WMS 庫存、缺貨阻擋與調撥開關**。產品已確認所有商品均映射 WMS SKU、店面預設單一供貨倉、缺貨拒絕 checkout、顧客可登記到貨通知，且商品須實際回倉並完成 WMS 入庫／退回過帳才恢復可售。開關預設關閉以禁止跨倉調撥；啟用後仍由 WMS transfer service 控制。Reservation 時點／期限與未出貨取消釋回條件須由實作 Issue 限縮為不造成假庫存的生命週期規則；不可將 balance read 當交易保證。

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

1. **已決：**所有 E-Commerce 商品都必須映射同租戶 WMS SKU；不支援不追蹤庫存商品。
2. **已決：**店面先指定個別出貨倉，預設不跨倉調撥；有設定開關可允許 WMS 跨倉調撥。其他倉數量不可直接併入可售量。
3. **已決：**缺貨顯示缺貨並禁止 checkout；顧客可以登記 email 到貨通知。
4. **已決：**已出貨或其他需要回庫的情況，待實際回倉並完成 WMS 入庫／退回過帳後才恢復可售；禁止單純手動把 E-Commerce 數量改回可售。
5. **待實作 Issue 明訂：**reservation 建立時點／期限、未出貨取消的釋回時機、通知重送／退訂與隱私保存、未分配儲位是否可售，以及跨倉開關啟用後是調撥還是允許跨倉履約。缺貨不得接受訂單、不得負庫存為既有約束。

PR #29 為本探索文件的 Draft PR；產品已答覆主要政策，實作依賴 Issue #30。Issue #28 等 PR 合併前維持 open。
