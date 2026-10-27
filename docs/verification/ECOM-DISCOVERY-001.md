# ECOM-DISCOVERY-001 驗證紀錄

日期：2026-10-28

## 交付內容

- 新增 `docs/ECOMMERCE-REQUIREMENTS.md`，整理已知方向、架構約束、候選流程、資料 owner、核心風險、MVP 分期與待決問題。
- 更新 `docs/PRD.md`、`docs/ARCHITECTURE.md`、`docs/ROADMAP.md`，連結探索文件並保留未核定政策標記。
- 本 Issue 是文件探索；未新增程式、schema、API、UI、外部整合或客戶資料。

## 文件驗證

- `git diff --check`：通過。
- 新增文件內的相對文件連結：手動確認皆指向此分支存在檔案。
- 應用 lint、typecheck、test、build：未執行。此次只有 Markdown 需求文件變更，不影響程式碼；沒有將應用測試描述為通過。
- GitHub Actions：Draft PR 建立後檢查該 PR 的實際狀態，文件-only 修改是否觸發工程 CI 依 workflow 設定確認。

## 尚未核定

B2C/B2B、店家與商店數量、商品與 WMS SKU 關係、幣別／稅務、買家登入／CRM 關係、支付／配送供應商、庫存預留與扣減、退款／保存政策、員工權限仍待使用者確認。本文只提出 discovery 候選，不代表 E-Commerce 交易功能可進入實作。
