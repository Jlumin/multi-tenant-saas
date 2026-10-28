import Link from "next/link";
import { RestaurantPanel } from "./restaurant-panel";

export default function RestaurantPage() {
  return <main><p className="eyebrow">RESTAURANT · QR 點餐與 POS</p><h1>餐廳管理與店員 POS</h1><p>Owner 管理餐廳、菜單和桌位 QR；Owner／Member 處理訂單。訪客掃描桌位 QR 後可瀏覽菜單並送出訂單。</p><nav><Link href="/workspaces">工作空間</Link><Link href="/sign-in">帳號與登入</Link></nav><RestaurantPanel /></main>;
}
