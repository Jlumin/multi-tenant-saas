import Link from "next/link";
import { OrdersPanel } from "./panel";

export default function EcommerceOrdersPage() {
  return <main><p className="eyebrow">M3 · E-COMMERCE</p><h1>訂單</h1><p>只有租戶 Owner 能查看訪客訂單與買家聯絡資料。</p><OrdersPanel /><p><Link href="/ecommerce">返回商品目錄</Link></p></main>;
}
