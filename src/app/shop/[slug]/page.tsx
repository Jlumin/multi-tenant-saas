import { notFound } from "next/navigation";
import { getDatabase } from "../../../server/platform";
import { TenantError } from "../../../server/tenancy/service";
import { createEcommerce } from "../../../server/ecommerce/service";
export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let store: Awaited<ReturnType<ReturnType<typeof createEcommerce>["publicStore"]>>;
  try {
    store = await createEcommerce(getDatabase()).publicStore(slug);
  } catch (error) { if (error instanceof TenantError && error.status === 404) notFound(); throw error; }
  return <main><p className="eyebrow">公開商品目錄</p><h1>{store.name}</h1><p>商品目錄</p>{!store.products.length && <p>目前沒有上架商品。</p>}<section>{store.products.map(product => <article key={product.id}><h2>{product.name}</h2>{product.description && <p>{product.description}</p>}<p><strong>{store.currency} {product.price}</strong></p></article>)}</section></main>;
}
