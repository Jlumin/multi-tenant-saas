# CRM 會員資料（CRM-001）

狀態：依 Issue #36 實作中；此切片以租戶內聯絡人目錄為最小 CRM 會員資料功能。欄位、可見範圍及保存假設待整體試用確認。

## 第一版行為

- 每個 tenant 有獨立 CRM 聯絡人資料；CRM 只寫 crm_contacts，不改 identity/membership 或 E-Commerce、WMS、Restaurant 的表。
- 每筆資料包含姓名、選填 email/電話、選填備註、版本、建立／更新時間及封存狀態；沒有公開註冊或 CRM 自助登入。
- Owner 建立、更新、封存資料；有效 tenant Member 可搜尋與閱讀。未登入者、非成員與其他 tenant 成員不可存取。
- Email 去空白並轉小寫；電話接受常見格式符號後僅保存 + 與數字。email/phone 若填寫，在同 tenant 內包含封存資料仍唯一；兩欄都可空白。
- 列表只顯示未封存聯絡人，依 tenant 限定搜尋姓名、email 或電話並分頁。封存會設 archived_at 並保留原始列；封存後不提供編輯或復原。
- Owner 寫入與 audit 在同一交易；一般日誌只記 request ID、操作結果與錯誤碼，不記聯絡資料、備註或完整 payload。
- Profile note 是自由文字並可能包含個資，使用者應只保存必要資訊；保存期限與正式個資／同意政策尚未定案。

## 不包含

行銷活動、Email/SMS、同意／法遵自動化、會員點數、分群、匯入匯出、自助註冊、會員登入、跨租戶比對、分析報表，以及與 E-Commerce／Restaurant 訂單關聯。

## 待整體驗收確認

1. CRM 欄位是否需要生日、地址、性別或其他資訊（預設不收集）。
2. email／電話是否應於封存後釋放給新檔（目前仍保留唯一性）。
3. Member 是否可看所有聯絡方式與備註，及是否應以角色遮蔽部分欄位。
4. 聯絡資料／備註保存期限、刪除或匿名化需求及使用者同意政策。
5. 是否讓未登入客戶建立會員，或將 E-Commerce／Restaurant 訂單連結至 CRM。

驗證結果見 [CRM-001 驗證紀錄](verification/CRM-001.md)。
