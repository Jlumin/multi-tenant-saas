# Phase 7 驗證紀錄：租戶品牌與圖片管理

執行日期：2026-10-30（本機 Asia/Taipei）。本文件記錄本機 Docker Compose 開發環境驗證；不代表正式環境部署或驗收。

## 功能範圍

- 各租戶可設定品牌名稱、主色、輔色及 Logo。
- WMS 商品可管理圖片；登入中的 E-Commerce 租戶成員透過 WMS 公開服務取得商品圖 URL。
- 品牌與商品圖片皆由登入且屬於該租戶的成員讀取，僅租戶管理員可新增、替換或移除。
- 圖檔只接受 JPEG、PNG、WebP；每檔最多 5 MiB，單邊最多 4096 px，總像素最多 16 MP。
- Logo／商品圖片儲存於 Compose `media_data` named volume，沒有將圖片放進資料庫或 Git。

## 本機驗證

| 檢查 | 結果 |
|---|---|
| `docker compose ... exec backend python manage.py check` | 通過，0 issues |
| `makemigrations --check --dry-run` | 通過，No changes detected |
| `migrate --check` | 通過 |
| `python manage.py test` | 通過，77 tests |
| 上傳檔案超過 5 MiB | Logo 與商品圖片皆拒絕，HTTP 400 |
| 圖片寬度超過 4096 px | Logo 與商品圖片皆拒絕，HTTP 400 |
| 租戶／角色隔離、CSRF、圖片讀取／刪除、E-Commerce 取 WMS 圖片 | 後端 API 測試通過 |
| `npm run typecheck` | 通過 |
| `npm run build` | 通過，Angular production bundle 完成 |
| `pip-audit -r apps/backend/requirements.txt` | 通過，No known vulnerabilities found；Pillow 升級至 13.0.0 |
| Compose 設定檢查與 backend/frontend/db 健康狀態 | 通過；本機 UI 位於 `http://localhost:4200/` |
| Media volume 持久性 | 在 `/app/media` 寫入檢查檔、重啟 backend 後讀取成功，之後已移除檢查檔 |

## 發布前仍需完成

- GitHub Actions backend、frontend、Compose、secrets 四個工作均已通過。CI 首輪發現 CSRF 上傳測試未隔離 media 目錄的問題，改用暫存目錄後重跑通過。
- 正式環境必須將資料庫與 media volume 做一致時間點、加密且異地的備份，並共同演練還原；現有 PostgreSQL 備份腳本不涵蓋 media volume。
- 本階段沒有正式環境部署、公開 storefront、CDN／物件儲存、Restaurant 菜單圖片或圖片裁切功能。
