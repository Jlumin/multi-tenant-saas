import Link from "next/link";
import { EcommercePanel } from "./panel";
export default function EcommercePage() {
  return <main><p className="eyebrow">M3 · E-COMMERCE</p><h1>店面與商品目錄</h1><p>Owner 可管理店面與商品；所有租戶成員可查看管理目錄。公開瀏覽僅顯示啟用店面中的上架商品。</p><nav><Link href="/ecommerce/orders">訂單管理</Link></nav><EcommercePanel /><p><Link href="/">返回首頁</Link></p></main>;
}
