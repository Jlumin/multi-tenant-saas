# Phase 7：租戶品牌與圖片管理

Phase 7 在共用平台核心加入每租戶品牌設定，WMS 持有商品圖片；E-Commerce 只透過 WMS 公開應用服務取得租戶內商品圖片 URL，不直接讀取或寫入 WMS 表。餐飲菜單圖片、公開 storefront、CDN／物件儲存、圖片裁切及批次商品匯入不在此階段。

## 功能

- Tenant Branding：品牌名稱、主色、輔色與一張 Logo。未設定時以租戶名稱與預設色彩呈現。
- WMS Product：每個租戶商品可有一張圖片；同租戶的登入限定 E-Commerce 上架顯示此圖，不複製圖片或建立跨模組外鍵。
- 前端在登入工作空間顯示目前租戶 Logo／配色。租戶切換時重新載入品牌設定；登出清除品牌狀態。
- 支援 JPEG、PNG、WebP；每檔最多 5 MiB，寬高不超過 4096 px，總像素最多 16 MP。SVG、動畫圖檔及其他檔案格式不接受。

## API 與權限

所有路徑均限登入 session，並由 tenant id、啟用 membership 及租戶範圍查詢控制：

| 路徑 | 方法 | 權限 | 用途 |
|---|---|---|---|
| `/api/v1/tenants/{tenant}/branding/` | GET | 租戶成員 | 讀取品牌名稱、顏色與 Logo URL |
| 同上 | PATCH | 租戶管理員 | 更新名稱與兩個 HEX 顏色 |
| `/api/v1/tenants/{tenant}/branding/logo/` | GET | 租戶成員 | 讀取同租戶 Logo 圖檔 |
| 同上 | POST / DELETE | 租戶管理員 | 上傳或移除 Logo |
| `/api/v1/tenants/{tenant}/wms/products/{product}/image/` | GET | 租戶成員 | 讀取同租戶商品圖片 |
| 同上 | POST / DELETE | 租戶管理員 | 上傳或移除商品圖片 |

修改 session 的 POST／PATCH／DELETE 使用同源 Cookie 並要求 CSRF。圖片 GET 也需要同租戶登入，不是公開資產 URL。E-Commerce 只回傳這個受保護路徑，沒有增加匿名購物 API。

## 資料與檔案持久性

- `platform_core.TenantBranding` 以 tenant one-to-one 關係保存名稱、HEX 顏色與 Logo 路徑。
- `wms.Product.image` 保存租戶商品圖路徑。檔名由 UUID 產生，目錄依 tenant id 與用途分區，不使用上傳原始檔名。
- 資料庫保留 metadata；檔案存放在 Django `MEDIA_ROOT`，Compose named volume `media_data` 同時供開發與 production backend 掛載。production Nginx 只轉送受授權 API，不直接公開 media 目錄。
- PostgreSQL dump 不包含 media volume。正式上線前，資料庫與 media 必須採一致時間點備份、加密異地保存，並一起演練還原；目前的 Phase 6 PostgreSQL backup 腳本本身不備份 media volume。
