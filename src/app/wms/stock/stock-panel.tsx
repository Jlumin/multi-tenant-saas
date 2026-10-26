"use client";

import { useEffect, useState, type FormEvent } from "react";

type Master = { id: string; code: string; name: string; isActive: boolean; baseUnit?: string; factor?: number; isBase?: boolean; isDefault?: boolean };
type Unit = Master & { factor: number; version: number };
type Workspace = { role: "owner" | "member"; tenant: { id: string; name: string } };
type Line = { id: string; productId: string; locationId: string; unitId: string; unitCode: string; unitName: string; baseUnit: string; quantity: number; factor: number; unitVersion: number; baseQuantity: number; position: number };
type Doc = { id: string; number: string; type: "inbound" | "outbound"; status: "draft" | "posted" | "cancelled"; memo: string; warehouseId: string; version: number; createdAt: string; lines: Line[] };
type Balance = { tenantId: string; productId: string; warehouseId: string; locationId: string; quantity: number };
type Page<T> = { items: T[]; total: number; limit: number; offset: number };
const messages: Record<string, string> = { unauthenticated: "請先登入。", not_found: "資料不存在或沒有存取權。", owner_required: "只有 Owner 可以過帳。", master_inactive: "商品、倉庫、儲位或單位已停用。", insufficient_stock: "庫存不足，沒有過帳任何明細。", stock_overflow: "庫存超過整數上限。", unit_changed: "包裝規格已變更，請更新草稿明細後再過帳。", version_conflict: "單據已被更新，請重新載入。", document_not_editable: "只有草稿可以修改。", document_not_cancellable: "只有草稿可以取消。", document_not_postable: "只有草稿可以過帳。", idempotency_conflict: "此請求識別碼已用於其他內容。", invalid_quantity: "數量必須是正整數。", invalid_lines: "請完整選擇商品、儲位、單位和數量。" };
async function request<T>(path: string, method = "GET", body?: unknown, key?: string): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${messages[data.error?.code] ?? "操作失敗，請檢查輸入或稍後重試。"} (${data.error?.requestId ?? response.status})`);
  return data as T;
}
const stockPath = (tenantId: string) => `/api/wms-stock/${tenantId}`;
const masterPath = (tenantId: string) => `/api/wms/${tenantId}`;
const typeName = (type: Doc["type"]) => type === "inbound" ? "入庫" : "出庫";
const statusName = (status: Doc["status"]) => ({ draft: "草稿", posted: "已過帳", cancelled: "已取消" })[status];

export function StockPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]), [tenantId, setTenantId] = useState("");
  const [type, setType] = useState<Doc["type"]>("inbound"), [warehouses, setWarehouses] = useState<Master[]>([]), [locations, setLocations] = useState<Master[]>([]), [products, setProducts] = useState<Master[]>([]), [units, setUnits] = useState<Unit[]>([]);
  const [warehouseId, setWarehouseId] = useState(""), [locationId, setLocationId] = useState(""), [productId, setProductId] = useState(""), [unitId, setUnitId] = useState(""), [count, setCount] = useState("1"), [memo, setMemo] = useState("");
  const [documents, setDocuments] = useState<Doc[]>([]), [selected, setSelected] = useState<Doc | null>(null), [balances, setBalances] = useState<Balance[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const role = workspaces.find(item => item.tenant.id === tenantId)?.role;
  const draftEditable = !selected || selected.status === "draft";
  async function loadWorkspace(id: string) {
    setTenantId(id); setSelected(null); setMessage("");
    if (!id) { setWarehouses([]); setProducts([]); setLocations([]); setUnits([]); setDocuments([]); setBalances([]); return; }
    const [wh, pr, docs] = await Promise.all([
      request<Page<Master>>(`${masterPath(id)}/warehouses?limit=100`), request<Page<Master>>(`${masterPath(id)}/products?limit=100`), request<Page<Doc>>(`${stockPath(id)}/documents?limit=50`),
    ]);
    const activeWarehouses = wh.items.filter(item => item.isActive), activeProducts = pr.items.filter(item => item.isActive);
    setWarehouses(activeWarehouses); setProducts(activeProducts); setDocuments(docs.items);
    const firstWarehouse = activeWarehouses[0]?.id ?? "", firstProduct = activeProducts[0]?.id ?? "";
    setWarehouseId(firstWarehouse); setProductId(firstProduct);
    await Promise.all([loadLocationData(id, firstWarehouse), loadUnits(id, firstProduct)]);
  }
  async function refreshDocs(id = tenantId) { if (id) setDocuments((await request<Page<Doc>>(`${stockPath(id)}/documents?limit=50`)).items); }
  async function loadLocationData(id: string, warehouse: string) {
    if (!id || !warehouse) { setLocations([]); setLocationId(""); setBalances([]); return; }
    const [loc, bal] = await Promise.all([request<Page<Master>>(`${masterPath(id)}/warehouses/${warehouse}/locations?limit=100`), request<Page<Balance>>(`${stockPath(id)}/balances?warehouseId=${warehouse}&limit=100`)]);
    const activeLocations = loc.items.filter(item => item.isActive); setLocations(activeLocations); setLocationId(activeLocations.find(item => item.isDefault)?.id ?? activeLocations[0]?.id ?? ""); setBalances(bal.items);
  }
  async function loadUnits(id: string, product: string) {
    if (!id || !product) { setUnits([]); setUnitId(""); return; }
    const page = await request<Page<Unit>>(`${masterPath(id)}/products/${product}/units?limit=100`); const active = page.items.filter(item => item.isActive); setUnits(active); setUnitId(active.find(item => item.isBase)?.id ?? active[0]?.id ?? "");
  }
  useEffect(() => { void request<Page<Workspace>>("/api/tenancy?limit=100").then(data => setWorkspaces(data.items)).catch(error => setMessage(error.message)); }, []);
  async function run(work: () => Promise<void>) { if (busy) return; setBusy(true); setMessage(""); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失敗。"); } finally { setBusy(false); } }
  function selectedDoc(doc: Doc) {
    setSelected(doc); setType(doc.type); setWarehouseId(doc.warehouseId); setMemo(doc.memo);
    const line = doc.lines[0]; if (line) { setProductId(line.productId); setLocationId(line.locationId); setUnitId(line.unitId); setCount(String(line.quantity)); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const line = { productId, locationId, unitId, quantity: Number(count) };
      let saved: Doc;
      if (selected?.status === "draft") saved = await request<Doc>(`${stockPath(tenantId)}/documents/${selected.id}`, "PATCH", { version: selected.version, memo, lines: [line] });
      else saved = await request<Doc>(`${stockPath(tenantId)}/documents`, "POST", { type, warehouseId, memo, lines: [line] });
      setSelected(saved); setMemo(saved.memo); await refreshDocs(); setMessage(`${typeName(saved.type)}草稿已儲存：${saved.number}`);
    });
  }
  async function cancel() { if (!selected) return; await run(async () => { const doc = await request<Doc>(`${stockPath(tenantId)}/documents/${selected.id}/cancel`, "POST", { version: selected.version }); setSelected(doc); await refreshDocs(); setMessage("草稿已取消，庫存沒有異動。"); }); }
  async function post() { if (!selected) return; await run(async () => { const doc = await request<Doc>(`${stockPath(tenantId)}/documents/${selected.id}/post`, "POST", { version: selected.version }, crypto.randomUUID()); setSelected(doc); await refreshDocs(); await loadLocationData(tenantId, doc.warehouseId); setMessage(`${typeName(doc.type)}已過帳，庫存異動已寫入。`); }); }
  const available = balances.find(item => item.productId === productId && item.locationId === locationId)?.quantity ?? 0;
  return <>
    {message && <p role="status" className="notice">{message}</p>}
    <label>工作空間<select aria-label="工作空間" disabled={busy} value={tenantId} onChange={event => void run(() => loadWorkspace(event.target.value))}><option value="">請選擇工作空間</option>{workspaces.map(item => <option key={item.tenant.id} value={item.tenant.id}>{item.tenant.name} · {item.role}</option>)}</select></label>
    {tenantId && <>
      <nav aria-label="單據類型"><button type="button" disabled={busy} aria-pressed={type === "inbound"} onClick={() => { setType("inbound"); setSelected(null); setMemo(""); }}>入庫</button><button type="button" disabled={busy} aria-pressed={type === "outbound"} onClick={() => { setType("outbound"); setSelected(null); setMemo(""); }}>出庫</button></nav>
      <h2>{selected ? `${typeName(selected.type)}單 ${selected.number} · ${statusName(selected.status)}` : `新增${typeName(type)}草稿`}</h2>
      <form aria-label="庫存單據" onSubmit={submit}><fieldset disabled={busy || !draftEditable}>
        <label>倉庫<select required value={warehouseId} onChange={event => { const value = event.target.value; setWarehouseId(value); void run(() => loadLocationData(tenantId, value)); }}><option value="">請選倉庫</option>{warehouses.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label>儲位<select required value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">請選儲位</option>{locations.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label>商品<select required value={productId} onChange={event => { const value = event.target.value; setProductId(value); void run(() => loadUnits(tenantId, value)); }}><option value="">請選商品</option>{products.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <p>此商品此儲位現有量：{available} {products.find(item => item.id === productId)?.baseUnit ?? ""}</p>
        <label>數量單位<select required value={unitId} onChange={event => setUnitId(event.target.value)}><option value="">請選單位</option>{units.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}（1 = {item.factor} {products.find(product => product.id === productId)?.baseUnit}）</option>)}</select></label>
        <label>數量<input aria-label="數量" type="number" required min={1} max={2147483647} step={1} value={count} onChange={event => setCount(event.target.value)} /></label>
        <label>備註（選填）<input maxLength={500} value={memo} onChange={event => setMemo(event.target.value)} /></label>
        <button type="submit" disabled={!tenantId || !warehouseId || !locationId || !productId || !unitId}>{selected?.status === "draft" ? "儲存草稿" : `建立${typeName(type)}草稿`}</button>
      </fieldset></form>
      {selected?.status === "draft" && <nav><button type="button" disabled={busy} onClick={() => void run(cancel)}>取消草稿</button><button type="button" disabled={busy || role !== "owner"} onClick={() => void run(post)}>Owner 過帳</button></nav>}
      <h2>庫存單據</h2>
      {!documents.length && <p>目前沒有庫存單據。儲存入庫或出庫草稿後會列在這裡。</p>}
      {documents.map(doc => <article key={doc.id}><h3>{typeName(doc.type)} · {doc.number} · {statusName(doc.status)}</h3><p>{doc.lines.length} 項明細 · 版本 {doc.version} · {new Date(doc.createdAt).toLocaleString()}</p><button type="button" disabled={busy} onClick={() => void run(async () => selectedDoc(await request<Doc>(`${stockPath(tenantId)}/documents/${doc.id}`)))}>查看單據</button></article>)}
      <h2>目前庫存（大於零）</h2>
      {!balances.length && <p>所選倉庫目前沒有庫存。</p>}
      {balances.map(balance => { const product = products.find(item => item.id === balance.productId), location = locations.find(item => item.id === balance.locationId); return <p key={`${balance.productId}:${balance.locationId}`}>{product?.code ?? "商品"} · {location?.code ?? "儲位"}：{balance.quantity} {product?.baseUnit}</p>; })}
    </>}
  </>;
}
