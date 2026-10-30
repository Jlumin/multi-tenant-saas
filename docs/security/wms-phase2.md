# WMS Phase 2 安全與授權

- WMS endpoint 預設需要登入；tenant path 只作 selector，membership／tenant active 狀態由 platform service 重新查詢。非成員或跨租戶物件回 404；角色不足回 403。
- admin 管理商品、包裝單位、倉庫與儲位及執行過帳；manager 管理草稿；viewer 唯讀。每次 mutation 以 SessionAuthentication 執行 CSRF 檢查。
- Request serializer 拒絕未知欄位；tenant、membership、posted_by、庫存餘額及 movement delta 都由 server 決定，瀏覽器不能指定。
- 商品 SKU 與單位換算快照不得透過已存在的歷史單據重新解讀。出庫服務於租戶交易鎖後重新讀取餘額，不足時整筆 rollback；資料庫 CHECK 拒絕負餘額。
- Phase 3 有效 reservation 佔用各儲位可售量；一般 WMS issue 在 tenant lock 下需保留這些數量，不能手動出掉。E-Commerce capture 由 WMS application contract 原子扣用 reservation 並建立 issue/movement；不能直接變更餘額。
- 文件、line snapshot、餘額和 movement 在同一 transaction 更新；成功動作 metadata audit 同 transaction，審計失敗則業務寫入回滾。審計不保存 note、完整 request payload 或客戶資料。
- 單據和 movement 保留，不硬刪除已確認交易；本版不提供 posted reversal。修正已過帳錯誤要由後續調整／沖銷規格設計。
- 尚未有 RLS、共享快取限流、runtime DB 最小權限、集中告警、外部 audit archive、備份還原演練、正式 TLS 或部署設定。本地 Phase2 不適合公開網際網路或客戶正式資料。

