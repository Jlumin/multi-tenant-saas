# ECOM-004 金流供應商選項驗證

日期：2026-10-29。此 PR 只整理官方供應商資料，不新增支付程式、migration 或商業政策。

| 驗證 | 結果 | 證據 |
| --- | --- | --- |
| 官方來源核對 | PASS | 查閱 ECPay、NewebPay、TapPay、LINE Pay、Stripe 官方文件；來源與查閱日期列於 `docs/ECOM-004-PAYMENT-PROVIDER-OPTIONS.md`。 |
| 相對 Markdown 連結 | PASS | 新決策文件共 9 個連結，無遺失的相對路徑目標。 |
| `git diff --check` | PASS | 無 whitespace errors。 |
| GitHub Actions | PASS | Run #40737280873（run number 46），lint、typecheck、unit、DB validate/smoke、PostgreSQL integration、dev/prod HTTP smoke、build 與 auth HTTP smoke 全部成功。 |
| 人工瀏覽器付款流程 | NOT RUN | 供應商與商戶 sandbox 憑證尚未選定／提供；沒有執行真實或 sandbox 交易。 |

供應商、商戶登記地區、幣別、支付方式、未付款與 WMS 預留期限、退款政策、對帳及稅務／發票仍待產品決定。官方文件不等於商戶已取得服務資格；任何實際啟用或交易前需按商戶合約重查。
