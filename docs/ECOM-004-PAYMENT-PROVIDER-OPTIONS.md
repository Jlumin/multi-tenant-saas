# ECOM-004 金流供應商選項

日期：2026-10-29。這是供產品決策的資料整理，不是商戶資格、費率或法律／稅務意見，也沒有核定供應商或支付政策。整理範圍以台灣商戶可能使用的官方文件為主；實際可用功能須以商戶簽約、啟用項目及供應商最新文件為準。

## 目前可確認的差異

| 選項 | 官方文件可確認的流程／能力 | 導入與限制 | 初步定位（提案） |
| --- | --- | --- | --- |
| 綠界 ECPay | All-in-One 提供信用卡、WebATM、ATM、超商代碼、超商條碼、Apple Pay、電子支付等選項；建立交易後導向供應商付款頁。付款結果由 server-to-server POST 通知，商家需驗證 CheckMacValue；前端 redirect 不應作為唯一付款依據。 | 供應商說明商戶可用方式依會員／合約啟用而異。ATM、超商代碼及條碼不是即時付款；條碼結果通知可能在付款後兩日才回來。Stage sandbox 可用。退款前需查詢交易狀態，依授權／請款狀態選擇取消或退款 API。 | 若台灣商戶要信用卡加 ATM／超商付款，值得列入第一輪詢價與 sandbox 驗證。 |
| 藍新 NewebPay | 官方整合文件涵蓋 MPG 交易、單筆查詢、取消授權、請／退款及電子錢包退款。 | 支付方式、退款可用性／期限及流程依開通服務與交易種類而異；官方條款對不同支付工具訂有不同退款規則，正式決定前應向供應商確認實際商店設定及撥款／退款限制。 | 可與綠界一起作為台灣本地多支付方式候選，需以實際可開通方式、費率及退款條款比較。 |
| TapPay | 支援信用卡 Direct Pay、使用一次性 prime token 的伺服器付款，以及部分電子支付；支援後端通知與 Record API 查詢。官方文件提供全額／部分退款 API。 | Direct Pay 會在商家前端輸入卡片資料並透過 TapPay gateway 處理；本專案應評估 tokenized/hosted 類流程、PCI 責任與 UI 邊界，不儲存卡號／CVV。退款 API 送出不等於銀行已完成退款，文件建議隔日查交易狀態。 | 若信用卡體驗與統一交易 API 優先，且可接受前端 SDK／token 流程，值得列入候選；本地 ATM／超商涵蓋度需另核實。 |
| LINE Pay | Taiwan FAQ 說明 API 僅接受 TWD 清算，提供 sandbox，並要求管理商店 API 伺服器 IP；正式環境會產生真實交易。官方整合文件包含 reserve/confirm 與退款流程，且部分款項可部分退款。 | LINE Pay 是錢包，不是信用卡／ATM／超商全功能替代品；正式商店需申請並設定商店金鑰與伺服器 IP。測試商店交易會每日自動退款。 | 可作為台灣買家需要 LINE Pay 時的附加支付方式，而非第一個全能收款供應商。 |
| Stripe | Stripe 官方全球可用地區清單目前沒有台灣。 | 台灣設立的商戶不能依此假定可直接開設 Stripe Payments 帳戶；若商戶實體位於 Stripe 支援地區，需再依其實際公司／銀行資料確認資格。 | 除非商戶有合資格的支援地區法律實體，否則不建議作為台灣本地商戶第一版預設。 |

## 條件式建議

若第一批商戶是在台灣收款、以 TWD 計價，且要信用卡與 ATM／超商付款，先向綠界及藍新索取實際可用服務、費率、撥款與退款條款，並各自以官方 sandbox 驗證。若 MVP 只需要信用卡與電子錢包，也可把 TapPay 納入同一輪比較；LINE Pay 可依客群需求單獨加選。這只是比較順序建議，未替使用者決定供應商。

對任何選項，第一版應以供應商託管付款頁或 tokenization 降低本系統接觸卡片資料的範圍；後端以簽章通知／查詢 API 作為交易狀態來源；保存供應商交易參照、幣別、金額及狀態異動，不保存卡號、CVV、API secret 或完整敏感通知內容。前端返回頁只呈現狀態，不單獨確認已付款。

## 進入供應商實作前須確認

1. 商戶登記／收款地區與實際簽約主體；是否只先支援台灣 TWD。
2. 第一版必需支付方式：信用卡、ATM、超商代碼／條碼、LINE Pay 或其他錢包；非即時付款是否納入。
3. 未付款訂單及 ECOM-003 WMS 預留的期限。非即時付款的待付款時間需足以容納付款與通知延遲，逾時釋回庫存須可冪等執行。
4. 退款範圍（全額／部分）、可執行角色、是否需要二次核准、各支付方式的可退款期限和商店餘額限制。
5. 對帳第一版是使用商家後台人工核對，還是需匯入結算報表；稅／發票由誰負責。

## 官方來源

- [ECPay All-in-One Payment API](https://developers.ecpay.com.tw/16449/) — 付款方式、Stage/Production URL、server ReturnURL 與 client OrderResultURL。
- [ECPay Payment Result Notification](https://developers.ecpay.com.tw/16538/) — 回呼簽章驗證、server 通知與非即時支付通知時機。
- [ECPay Capture and Refund](https://developers.ecpay.com.tw/16567/) — 依交易狀態處理取消、請款與退款。
- [NewebPay 線上交易幕前支付串接手冊](https://www.newebpay.com/website/Page/content/download_api) — 官方 API 文件下載入口；整合範圍包含 MPG、Query、Cancel、Close 及錢包退款。
- [NewebPay API 文件公告](https://www.newebpay.com/info/news/news_detail?post_data=ba4aeb7de42bbf2297f75807079a096ecbe36eeb884416b4c5c950aa52220325) — 五類 API 文件概要。
- [TapPay Backend API](https://docs.tappaysdk.com/payment-request-api/en/back.html) — Direct Pay、E-Payment、Record 與退款流程。
- [LINE Pay Taiwan FAQ](https://pay.line.me/portal/tw/customer/faq?categoryId=cashflow) — TWD、sandbox／正式環境及測試交易說明。
- [LINE Pay Taiwan merchant integration guide](https://pay.line.me/file/guidebook/technicallinking/LINE_Pay_Integration_Guide_for_Merchant-ver1.0.6-cht%281%29.pdf) — reserve/confirm/refund API 交易流程。
- [Stripe global availability](https://stripe.com/global) — 官方支援國家／地區清單。

官方文件查閱日期：2026-10-29。供應商產品、商戶資格、合約與退款限制可能變動；開始實作及簽約前應重新確認。
