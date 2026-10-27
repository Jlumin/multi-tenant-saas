"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
interface Workspace { role: "owner" | "member"; tenant: { id: string; name: string } }
interface Store { id: string; tenantId: string; name: string; slug: string; currency: string; isActive: boolean; version: number }
interface Product { id: string; code: string; name: string; description: string; price: string; isPublished: boolean; version: number }
interface ProductPage { items: Product[]; total: number; limit: number; offset: number; role: "owner" | "member" }
class ApiError extends Error { constructor(public code: string, message: string) { super(message); } }
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); if (!response.ok) throw new ApiError(data.error?.code ?? "unknown", data.error?.requestId ?? String(response.status)); return data as T;
}
const explain = (error: unknown) => {
  if (!(error instanceof ApiError)) return "操作失敗，請稍後重試。";
  const messages: Record<string, string> = { unauthenticated: "請先登入並完成電子郵件驗證。", not_found: "找不到店面或商品，或目前沒有此工作空間的存取權。", owner_required: "此操作需要 Owner 權限。", store_exists: "每個工作空間目前只能建立一間店。", invalid_slug: "網址識別碼請使用小寫英數字與連字號。", invalid_currency: "請輸入有效的 ISO 4217 幣別代碼，例如 TWD。", invalid_product: "商品代碼、名稱或價格格式不正確。", invalid_store: "店名、幣別或版本資料不正確。", version_conflict: "資料已被更新，請重新載入後再試。", currency_locked: "建立商品後不能更換店面幣別，避免舊價格被當成另一種幣別。", store_inactive: "店面停用時不能上架商品。", invalid_origin: "來源驗證失敗，請使用設定的網站網址。" };
  return `${messages[error.code] ?? "操作失敗，請稍後重試。"} (${error.message})`;
};
const blankProducts: ProductPage = { items: [], total: 0, limit: 20, offset: 0, role: "member" };
export function EcommercePanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]); const [tenantId, setTenantId] = useState(""); const [role, setRole] = useState<"owner" | "member">("member");
  const [store, setStore] = useState<Store | null>(null); const [storeMissing, setStoreMissing] = useState(false); const [products, setProducts] = useState<ProductPage>(blankProducts);
  const [storeName, setStoreName] = useState(""); const [slug, setSlug] = useState(""); const [currency, setCurrency] = useState("TWD");
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [price, setPrice] = useState(""); const [published, setPublished] = useState(false); const [selected, setSelected] = useState<Product | null>(null);
  const [busy, setBusy] = useState(true); const [message, setMessage] = useState(""); const running = useRef(false);
  useEffect(() => { let cancelled = false; void request<{ items: Workspace[] }>("/api/tenancy?limit=100").then(data => { if (!cancelled) setWorkspaces(data.items); }).catch(error => { if (!cancelled) setMessage(explain(error)); }).finally(() => { if (!cancelled) setBusy(false); }); return () => { cancelled = true; }; }, []);
  async function load(id: string, offset = 0) {
    setStore(null); setStoreMissing(false); setProducts(blankProducts); setSelected(null); setStoreName(""); setSlug(""); setCurrency("TWD");
    if (!id) return;
    try { const next = await request<Store>(`/api/ecommerce/${id}/store`); setStore(next); setStoreName(next.name); setSlug(next.slug); setCurrency(next.currency); const page = await request<ProductPage>(`/api/ecommerce/${id}/products?limit=20&offset=${offset}`); setProducts(page); setRole(page.role); }
    catch (error) { if (error instanceof ApiError && error.code === "not_found") { setStoreMissing(true); const member = workspaces.find(w => w.tenant.id === id); setRole(member?.role ?? "member"); } else throw error; }
  }
  async function run(work: () => Promise<void>) { if (running.current) return; running.current = true; setBusy(true); setMessage(""); try { await work(); } catch (error) { setMessage(explain(error)); } finally { running.current = false; setBusy(false); } }
  function clearProduct() { setSelected(null); setCode(""); setName(""); setDescription(""); setPrice(""); setPublished(false); }
  async function saveStore(event: FormEvent) { event.preventDefault(); await run(async () => { if (store) { const updated = await request<Store>(`/api/ecommerce/${tenantId}/store`, "PATCH", { name: storeName, currency, isActive: store.isActive, version: store.version }); setStore(updated); setMessage("店面設定已儲存。"); } else { const created = await request<Store>(`/api/ecommerce/${tenantId}/store`, "POST", { name: storeName, slug, currency }); setStore(created); setStoreMissing(false); setMessage("店面已建立。"); await load(tenantId); } }); }
  async function saveProduct(event: FormEvent) { event.preventDefault(); await run(async () => { const result = await request<Product>(`/api/ecommerce/${tenantId}/products${selected ? `/${selected.id}` : ""}`, selected ? "PATCH" : "POST", { code, name, description, price, isPublished: published, ...(selected ? { version: selected.version } : {}) }); await load(tenantId); setSelected(result); setCode(result.code); setName(result.name); setDescription(result.description); setPrice(result.price); setPublished(result.isPublished); setMessage(selected ? "商品已更新。" : "商品已建立。"); }); }
  async function toggleStore() { if (!store) return; await run(async () => { const updated = await request<Store>(`/api/ecommerce/${tenantId}/store`, "PATCH", { name: store.name, currency: store.currency, isActive: !store.isActive, version: store.version }); setStore(updated); setMessage(updated.isActive ? "店面已啟用。" : "店面已停用，公開頁面已關閉。"); }); }
  return <>
    <nav><Link href="/workspaces">工作空間</Link><Link href="/projects">專案管理</Link><Link href="/wms">WMS 倉儲</Link><Link href="/sign-in">帳號與登入</Link></nav>
    {message && <p role="status" className="notice">{message}</p>}
    <label>工作空間<select value={tenantId} disabled={busy} onChange={e => { const id = e.target.value; setTenantId(id); setRole(workspaces.find(w => w.tenant.id === id)?.role ?? "member"); void run(() => load(id)); }}><option value="">請選擇工作空間</option>{workspaces.map(w => <option key={w.tenant.id} value={w.tenant.id}>{w.tenant.name} · {w.role}</option>)}</select></label>
    {!workspaces.length && !busy && <p>目前沒有可管理的工作空間。</p>}{busy && <p role="status">載入中…</p>}
    {tenantId && storeMissing && <section><h2>建立店面</h2><p>目前此工作空間尚未建立店面。Owner 可以建立；每個工作空間暫定只支援一間店。</p><form onSubmit={saveStore}><fieldset disabled={busy || role !== "owner"}><label>店面名稱<input required maxLength={120} value={storeName} onChange={e => setStoreName(e.target.value)} /></label><label>公開網址識別碼<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={64} value={slug} onChange={e => setSlug(e.target.value.toLowerCase())} /><span className="hint">公開網址：/shop/{slug || "your-store"}</span></label><label>幣別<input required pattern="[A-Za-z]{3}" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} /></label><button type="submit">建立店面</button></fieldset></form>{role !== "owner" && <p className="hint">只有 Owner 可以建立店面。</p>}</section>}
    {store && <>
      <section><h2>店面設定</h2><p>公開狀態：{store.isActive ? "啟用" : "停用"} · 幣別：{store.currency}</p><p>公開頁面：<Link href={`/shop/${store.slug}`} target="_blank">/shop/{store.slug}</Link></p><form onSubmit={saveStore}><fieldset disabled={busy || role !== "owner"}><label>店面名稱<input required maxLength={120} value={storeName} onChange={e => setStoreName(e.target.value)} /></label><label>幣別<input required pattern="[A-Za-z]{3}" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} /></label><button type="submit">儲存店面設定</button></fieldset></form>{role === "owner" && <button disabled={busy} onClick={() => void toggleStore()}>{store.isActive ? "停用公開店面" : "重新啟用店面"}</button>}<p className="hint">公開網址識別碼建立後固定，商品上架狀態可個別調整。</p></section>
      <section><h2>商品目錄（{products.total}）</h2>{!products.items.length && <p>尚無商品。</p>}{products.items.map(item => <article key={item.id}><h3>{item.name} · {item.code}</h3><p>{item.description || "尚無描述"}</p><p>{store.currency} {item.price} · {item.isPublished ? "已上架" : "草稿"}</p>{role === "owner" && <button disabled={busy} onClick={() => { setSelected(item); setCode(item.code); setName(item.name); setDescription(item.description); setPrice(item.price); setPublished(item.isPublished); }}>編輯商品</button>}</article>)}{products.total > products.limit && <nav aria-label="商品目錄分頁"><button disabled={busy || products.offset === 0} onClick={() => void run(() => load(tenantId, Math.max(0, products.offset - products.limit)))}>上一頁</button><span>第 {Math.floor(products.offset / products.limit) + 1} 頁 · 共 {products.total} 筆</span><button disabled={busy || products.offset + products.limit >= products.total} onClick={() => void run(() => load(tenantId, products.offset + products.limit))}>下一頁</button></nav>}</section>
      {role === "owner" && <section><h2>{selected ? "編輯商品" : "新增商品"}</h2><form onSubmit={saveProduct}><fieldset disabled={busy}><label>商品代碼<input required maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,39}" value={code} onChange={e => setCode(e.target.value.toUpperCase())} /></label><label>商品名稱<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label><label>商品說明<textarea maxLength={2000} rows={4} value={description} onChange={e => setDescription(e.target.value)} /></label><label>售價（{store.currency}）<input required inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?" value={price} onChange={e => setPrice(e.target.value)} /></label><label className="check"><input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} />公開上架</label><button type="submit">{selected ? "儲存商品" : "建立商品"}</button>{selected && <button type="button" onClick={clearProduct}>取消編輯</button>}</fieldset></form><p className="hint">商品不提供硬刪除；可取消上架。價格最多兩位小數。</p></section>}
      {role === "member" && <p className="hint">Member 可查看管理目錄；店面與商品編輯僅限 Owner。</p>}
    </>}
  </>;
}
