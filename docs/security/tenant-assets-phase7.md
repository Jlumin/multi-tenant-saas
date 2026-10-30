# Phase 7 品牌與圖片安全規則

- Branding 與商品圖片 API 預設 `IsAuthenticated` 並使用 SessionAuthentication。membership 查詢同時限定目前 tenant id、啟用使用者與啟用 tenant；不存在或跨租戶資源回 404。
- 只有租戶 admin 可變更品牌、Logo 或商品圖片。manager／viewer 可讀取同租戶圖片，不可上傳或刪除。每個寫入都要求 CSRF 並追加 tenant audit event。
- 圖片由 Pillow 解碼與驗證實際內容，不信任副檔名或瀏覽器 MIME。只接受 JPEG、PNG、WebP；拒絕 SVG、動畫格式、超過 5 MiB、邊長超過 4096 px 或超過 16 MP 的檔案。
- 原始檔名不會進入 storage path；路徑由 tenant id、用途與伺服器產生的 UUID 組成。`MEDIA_ROOT` 是 backend 私有 named volume，Nginx 不直接 serve 檔案。
- Phase 7 管理 API 圖片回應使用受授權 API、`Cache-Control: private`、`X-Content-Type-Options: nosniff` 與 same-origin 資源政策。Phase 8 另外提供獨立的公開 storefront 資產 API；只有店面已啟用且該商品存在啟用上架時才可匿名讀取，停用店面或下架商品不會由這些公開路徑送出。
- 限制 Django request body 與 Nginx upload body。正式環境仍須在 TLS ingress 和防火牆層維持相同大小上限，並監控 media volume 容量。
- 備份須同時納入 PostgreSQL 與 media volume；現有 Phase 6 DB dump 只備份 PostgreSQL。media 的加密異地備份與同時間點還原測試是上線前必要工作。
