"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type Product = { id: string; code: string; name: string; description: string; price: string };
type Store = { name: string; slug: string; currency: string; products: Product[] };
type CartLine = { productId: string; quantity: number };
type CheckoutResult = { orderNumber: string; currency: string; totalAmount: string };

export function ShopCart({ store }: { store: Store }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const products = useMemo(() => new Map(store.products.map(product => [product.id, product])), [store.products]);
  const lines = cart.flatMap(line => { const product = products.get(line.productId); return product ? [{ ...line, product }] : []; });
  const totalCents = lines.reduce((sum, line) => {
    const [whole, fraction = ""] = line.product.price.split(".");
    return sum + (Number(whole) * 100 + Number((fraction + "00").slice(0, 2))) * line.quantity;
  }, 0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try { const saved: unknown = JSON.parse(localStorage.getItem(`ecom-cart:${store.slug}`) ?? "[]"); if (Array.isArray(saved)) setCart(saved.filter(line => line && typeof line.productId === "string" && products.has(line.productId) && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 99)); } catch { setCart([]); }
      setCartReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [store.slug, products]);
  useEffect(() => { if (cartReady) localStorage.setItem(`ecom-cart:${store.slug}`, JSON.stringify(cart)); }, [cart, cartReady, store.slug]);

  function change(productId: string, quantity: number) {
    setResult(null); setMessage(""); setIdempotencyKey("");
    setCart(current => quantity < 1 ? current.filter(line => line.productId !== productId) : current.some(line => line.productId === productId) ? current.map(line => line.productId === productId ? { ...line, quantity: Math.min(99, quantity) } : line) : [...current, { productId, quantity: 1 }]);
  }
  async function checkout(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setResult(null);
    const key = idempotencyKey || `${crypto.randomUUID()}_${crypto.randomUUID()}`;
    setIdempotencyKey(key);
    try {
      const response = await fetch(`/api/shop/${encodeURIComponent(store.slug)}/checkout`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ buyerName: name, buyerEmail: email, lines: cart.map(({ productId, quantity }) => ({ productId, quantity })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.code ?? "checkout_failed");
      setResult(data); setCart([]); setIdempotencyKey(""); localStorage.removeItem(`ecom-cart:${store.slug}`);
    } catch (error) {
      const code = error instanceof Error ? error.message : "checkout_failed";
      const messages: Record<string, string> = { invalid_origin: "來源驗證失敗，請重新載入頁面。", invalid_payload: "結帳資料格式不正確。", invalid_buyer: "請輸入有效的姓名與電子郵件。", invalid_line: "商品數量必須為 1–99 的整數。", products_unavailable: "有商品已下架或無法購買，請更新購物車。", idempotency_conflict: "此次送單資料已變更，請調整購物車後重試。", service_unavailable: "目前無法送出訂單，請稍後重試。" };
      setMessage(messages[code] ?? "無法送出訂單，請稍後重試。");
    } finally { setBusy(false); }
  }

  return <>
    <section aria-labelledby="catalog-heading"><h2 id="catalog-heading">商品目錄</h2>{!store.products.length && <p>目前沒有上架商品。</p>}{store.products.map(product => <article key={product.id}><h3>{product.name}</h3>{product.description && <p>{product.description}</p>}<p><strong>{store.currency} {product.price}</strong></p><button type="button" onClick={() => change(product.id, (cart.find(line => line.productId === product.id)?.quantity ?? 0) + 1)}>加入購物車</button></article>)}</section>
    <section aria-labelledby="cart-heading">
    <h2 id="cart-heading">購物車與訪客結帳</h2>
    {result ? <div role="status"><h3>訂單已送出</h3><p>訂單編號：<strong>{result.orderNumber}</strong></p><p>訂單總額：{result.currency} {result.totalAmount}</p><p>目前狀態：待後續人工處理。</p></div> : <>
      {!lines.length && <p>購物車是空的，請從上方商品加入品項。</p>}
      {lines.map(line => <article key={line.productId}><h3>{line.product.name}</h3><p>{store.currency} {line.product.price} × {line.quantity}</p><label>數量<input aria-label={`${line.product.name}數量`} type="number" min={1} max={99} step={1} value={line.quantity} onChange={event => change(line.productId, Number(event.target.value))} /></label><button type="button" onClick={() => change(line.productId, 0)}>移除</button></article>)}
      {!!lines.length && <><p><strong>商品小計：{store.currency} {(totalCents / 100).toFixed(2)}</strong></p><form onSubmit={checkout}><fieldset disabled={busy}><label>姓名<input required maxLength={120} autoComplete="name" value={name} onChange={event => { setName(event.target.value); setIdempotencyKey(""); }} /></label><label>Email<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); setIdempotencyKey(""); }} /></label><p className="hint">此階段不收地址、電話或付款資料，也不會寄送通知信。</p><button type="submit">{busy ? "送出中…" : "送出訂單"}</button></fieldset></form></>}
      {message && <p role="alert" className="error">{message}</p>}
    </>}
    </section>
  </>;
}
