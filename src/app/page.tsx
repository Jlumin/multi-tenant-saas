import Link from "next/link";

export default function Home() {
  return (
    <main>
      <p className="eyebrow">MULTI-TENANT SAAS · M1</p>
      <h1>工程起點已就緒</h1>
      <p>本機開發骨架已建立，產品功能尚未啟用。</p>
      <a href="/api/health">查看服務健康狀態 <span aria-hidden="true">→</span></a>
      <Link href="/sign-in">Google／電子郵件登入</Link>
      <Link href="/workspaces">工作空間與成員</Link>
      <aside>登入與租戶成員基礎已加入；業務功能尚未啟用。</aside>
    </main>
  );
}
