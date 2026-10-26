import { WmsPanel } from "./wms-panel";
import Link from "next/link";

export default function WmsPage() {
  return <main><p className="eyebrow">WMS · 倉儲管理</p><h1>倉儲資料管理</h1><p>先建立商品、包裝單位與倉庫地點。未有貨架編碼時，可使用每倉的「未分配儲位」。</p><nav><Link href="/wms/stock">入庫與出庫</Link></nav><WmsPanel /></main>;
}
