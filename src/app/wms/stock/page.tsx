import Link from "next/link";
import { StockPanel } from "./stock-panel";

export default function StockPage() {
  return <main><p className="eyebrow">WMS · 庫存異動</p><h1>入庫與出庫</h1><p>單據先存為草稿；Owner 過帳後才更新庫存。出庫量不足時系統會拒絕過帳。</p><nav><Link href="/wms">商品、倉庫與儲位</Link><Link href="/projects">專案管理</Link><Link href="/workspaces">工作空間</Link></nav><StockPanel /></main>;
}
