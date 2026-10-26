import Link from "next/link";

export default function Home() {
  return (
    <main>
      <p className="eyebrow">MULTI-TENANT SAAS · M1 AUTH</p>
      <h1>工程起點已就緒</h1>
      <p>本機開發骨架已建立，產品功能尚未啟用。</p>
      <a href="/api/health">查看服務健康狀態 <span aria-hidden="true">→</span></a>
      <Link href="/sign-in">Google／電子郵件登入</Link>
      <aside>身分整合已加入；租戶授權及業務功能尚未啟用。</aside>
    </main>
  );
}
