import { WmsPanel } from "./wms-panel";

export default function WmsPage() {
  return <main><p className="eyebrow">WMS · 主檔管理</p><h1>倉儲資料管理</h1><p>先建立商品、包裝單位與倉庫地點。未有貨架編碼時，可使用每倉的「未分配儲位」。</p><WmsPanel /></main>;
}
