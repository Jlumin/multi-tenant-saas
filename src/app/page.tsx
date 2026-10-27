import Link from "next/link";

export default function Home() {
  return (
    <main>
      <p className="eyebrow">MULTI-TENANT SAAS · M2</p>
      <h1>你的團隊工作空間</h1>
      <p>登入後選擇工作空間，管理專案與團隊成員。</p>
      <a href="/api/health">查看服務健康狀態 <span aria-hidden="true">→</span></a>
      <Link href="/sign-in">Google／電子郵件登入</Link>
      <Link href="/workspaces">工作空間與成員</Link>
      <Link href="/projects">專案管理</Link>
      <Link href="/wms">WMS 倉儲主檔</Link>
      <Link href="/ecommerce">E-Commerce 店面與商品目錄</Link>
      <aside>專案、倉儲主檔與 E-Commerce 商品目錄已加入；目前為本機測試版本。</aside>
    </main>
  );
}
