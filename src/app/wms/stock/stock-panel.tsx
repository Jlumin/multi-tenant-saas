"use client";

import { useEffect, useState, type FormEvent } from "react";

type Master = { id: string; code: string; name: string; isActive: boolean; baseUnit?: string; factor?: number; isBase?: boolean; isDefault?: boolean; warehouseId?: string };
type Unit = Master & { factor: number; version: number };
type Workspace = { role: "owner" | "member"; tenant: { id: string; name: string } };
type Line = { id: string; productId: string; locationId: string; targetWarehouseId?: string | null; targetLocationId?: string | null; unitId: string; unitCode: string; unitName: string; baseUnit: string; quantity: number; factor: number; unitVersion: number; baseQuantity: number; position: number };
type Doc = { id: string; number: string; type: "inbound" | "outbound" | "transfer" | "opening" | "adjustment"; status: "draft" | "posted" | "cancelled"; memo: string; warehouseId: string; destinationWarehouseId?: string | null; reversalOfId?: string | null; version: number; createdAt: string; lines: Line[] };
type Balance = { tenantId: string; productId: string; warehouseId: string; locationId: string; quantity: number };
type Page<T> = { items: T[]; total: number; limit: number; offset: number };
type Movement = { id: string; delta: number; actorId: string; createdAt: string; document: { number: string; type: "inbound" | "outbound" | "transfer" | "opening" | "adjustment"; warehouseId: string; destinationWarehouseId: string | null; postedAt: string | null; postedById: string | null }; product: { code: string; name: string; baseUnit: string }; warehouse: { code: string; name: string }; location: { code: string; name: string }; line: { locationId: string; targetLocationId: string | null; unitCode: string; unitName: string; baseUnit: string; quantity: number; factor: number; baseQuantity: number; position: number } };
type QueryFilters = { productId: string; warehouseId: string; locationId: string };
type WmsSettings = { allowInterWarehouseTransfers: boolean; version: number };
const messages: Record<string, string> = { unauthenticated: "請先登入。", not_found: "資料不存在或沒有存取權。", owner_required: "只有 Owner 可以過帳。", master_inactive: "商品、倉庫、儲位或單位已停用。", insufficient_stock: "來源庫存不足，沒有過帳任何明細。", stock_reserved: "此庫存已有訂單預留，不能再出庫或調撥。", inter_warehouse_transfer_disabled: "目前已關閉跨倉調撥，請由 Owner 到本頁開啟後再試。", stock_overflow: "庫存超過整數上限。", unit_changed: "包裝規格已變更，請更新草稿明細後再過帳。", version_conflict: "單據已被更新，請重新載入。", document_not_editable: "只有草稿可以修改。", document_not_cancellable: "只有草稿可以取消。", document_not_postable: "只有草稿可以過帳。", idempotency_conflict: "此請求識別碼已用於其他內容。", invalid_quantity: "數量必須是正整數。", invalid_lines: "請完整選擇商品、來源／目的儲位、單位和數量。", same_location: "來源與目的儲位相同，請改選其他儲位。", invalid_transfer: "調撥目的資料不完整，請重新選擇目的倉庫與儲位。" };
async function request<T>(path: string, method = "GET", body?: unknown, key?: string): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${messages[data.error?.code] ?? "操作失敗，請檢查輸入或稍後重試。"} (${data.error?.requestId ?? response.status})`);
  return data as T;
}
const stockPath = (tenantId: string) => `/api/wms-stock/${tenantId}`;
const masterPath = (tenantId: string) => `/api/wms/${tenantId}`;
const typeName = (type: Doc["type"]) => ({ inbound: "入庫", outbound: "出庫", transfer: "調撥／移位", opening: "期初入庫", adjustment: "盤點調整" })[type];
const statusName = (status: Doc["status"]) => ({ draft: "草稿", posted: "已過帳", cancelled: "已取消" })[status];

export function StockPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]), [tenantId, setTenantId] = useState("");
  const [type, setType] = useState<Doc["type"]>("inbound"), [warehouses, setWarehouses] = useState<Master[]>([]), [locations, setLocations] = useState<Master[]>([]), [allLocations, setAllLocations] = useState<Master[]>([]), [products, setProducts] = useState<Master[]>([]), [units, setUnits] = useState<Unit[]>([]);
  const [warehouseId, setWarehouseId] = useState(""), [locationId, setLocationId] = useState(""), [destinationWarehouseId, setDestinationWarehouseId] = useState(""), [targetLocationId, setTargetLocationId] = useState(""), [productId, setProductId] = useState(""), [unitId, setUnitId] = useState(""), [count, setCount] = useState("1"), [memo, setMemo] = useState("");
  const [reverseReason, setReverseReason] = useState("");
  const [documents, setDocuments] = useState<Doc[]>([]), [selected, setSelected] = useState<Doc | null>(null), [selectedMovement, setSelectedMovement] = useState<Movement | null>(null), [balances, setBalances] = useState<Balance[]>([]), [formBalances, setFormBalances] = useState<Balance[]>([]), [balanceTotal, setBalanceTotal] = useState(0), [balanceOffset, setBalanceOffset] = useState(0), [movements, setMovements] = useState<Movement[]>([]), [movementTotal, setMovementTotal] = useState(0), [movementOffset, setMovementOffset] = useState(0), [queryFilters, setQueryFilters] = useState<QueryFilters>({ productId: "", warehouseId: "", locationId: "" }), [settings, setSettings] = useState<WmsSettings>({ allowInterWarehouseTransfers: false, version: 1 }), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const role = workspaces.find(item => item.tenant.id === tenantId)?.role;
  const draftEditable = !selected || selected.status === "draft";
  async function loadBalancePage(id: string, filters: QueryFilters, offset = 0) {
    if (!id) return { items: [], total: 0, limit: 20, offset } as Page<Balance>;
    const params = new URLSearchParams({ limit: "20", offset: String(offset) });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    return request<Page<Balance>>(`${stockPath(id)}/balances?${params}`);
  }
  async function loadMovementPage(id: string, filters: QueryFilters, offset = 0) {
    if (!id) return { items: [], total: 0, limit: 20, offset } as Page<Movement>;
    const params = new URLSearchParams({ limit: "20", offset: String(offset) });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    return request<Page<Movement>>(`${stockPath(id)}/movements?${params}`);
  }
  async function loadQueries(id = tenantId, filters = queryFilters, balancePage = 0, movementPage = 0) {
    const [balancePageResult, movementPageResult] = await Promise.all([loadBalancePage(id, filters, balancePage), loadMovementPage(id, filters, movementPage)]);
    setBalances(balancePageResult.items); setBalanceTotal(balancePageResult.total); setBalanceOffset(balancePageResult.offset);
    setMovements(movementPageResult.items); setMovementTotal(movementPageResult.total); setMovementOffset(movementPageResult.offset);
  }
  async function loadWorkspace(id: string) {
    setTenantId(id); setSelected(null); setSelectedMovement(null); setMessage("");
    const emptyFilters = { productId: "", warehouseId: "", locationId: "" };
    setQueryFilters(emptyFilters); setBalanceOffset(0); setMovementOffset(0);
    if (!id) { setWarehouses([]); setProducts([]); setLocations([]); setAllLocations([]); setUnits([]); setDocuments([]); setBalances([]); setFormBalances([]); setBalanceTotal(0); setMovements([]); setMovementTotal(0); setSettings({ allowInterWarehouseTransfers: false, version: 1 }); return; }
    const [wh, pr, docs, nextSettings] = await Promise.all([
      request<Page<Master>>(`${masterPath(id)}/warehouses?limit=100`), request<Page<Master>>(`${masterPath(id)}/products?limit=100`), request<Page<Doc>>(`${stockPath(id)}/documents?limit=50`), request<WmsSettings>(`${stockPath(id)}/settings`),
    ]);
    const activeWarehouses = wh.items.filter(item => item.isActive), activeProducts = pr.items.filter(item => item.isActive);
    setWarehouses(activeWarehouses); setProducts(activeProducts); setDocuments(docs.items); setSettings(nextSettings);
    const nestedLocations = await Promise.all(activeWarehouses.map(async item => {
      const result = await request<Page<Master>>(`${masterPath(id)}/warehouses/${item.id}/locations?limit=100`);
      return result.items.map(location => ({ ...location, warehouseId: item.id }));
    }));
    setAllLocations(nestedLocations.flat().filter(item => item.isActive));
    const firstWarehouse = activeWarehouses[0]?.id ?? "", firstProduct = activeProducts[0]?.id ?? "";
    const firstDestination = activeWarehouses.find(item => item.id !== firstWarehouse)?.id ?? "";
    setWarehouseId(firstWarehouse); setDestinationWarehouseId(firstDestination); setProductId(firstProduct);
    await Promise.all([loadLocationData(id, firstWarehouse), loadUnits(id, firstProduct), loadQueries(id, emptyFilters)]);
  }
  async function refreshDocs(id = tenantId) { if (id) setDocuments((await request<Page<Doc>>(`${stockPath(id)}/documents?limit=50`)).items); }
  async function toggleTransfers() { await run(async () => { const next = await request<WmsSettings>(`${stockPath(tenantId)}/settings`, "PATCH", { allowInterWarehouseTransfers: !settings.allowInterWarehouseTransfers, version: settings.version }); setSettings(next); setMessage(next.allowInterWarehouseTransfers ? "跨倉調撥已開啟。" : "跨倉調撥已關閉。"); }); }
  async function loadLocationData(id: string, warehouse: string) {
    if (!id || !warehouse) { setLocations([]); setLocationId(""); setFormBalances([]); return; }
    const [loc, bal] = await Promise.all([request<Page<Master>>(`${masterPath(id)}/warehouses/${warehouse}/locations?limit=100`), request<Page<Balance>>(`${stockPath(id)}/balances?warehouseId=${warehouse}&limit=100`)]);
    setFormBalances(bal.items);
    const activeLocations = loc.items.filter(item => item.isActive); setLocations(activeLocations); setLocationId(activeLocations.find(item => item.isDefault)?.id ?? activeLocations[0]?.id ?? "");
  }
  async function loadUnits(id: string, product: string) {
    if (!id || !product) { setUnits([]); setUnitId(""); return; }
    const page = await request<Page<Unit>>(`${masterPath(id)}/products/${product}/units?limit=100`); const active = page.items.filter(item => item.isActive); setUnits(active); setUnitId(active.find(item => item.isBase)?.id ?? active[0]?.id ?? "");
  }
  useEffect(() => { void request<Page<Workspace>>("/api/tenancy?limit=100").then(data => setWorkspaces(data.items)).catch(error => setMessage(error.message)); }, []);
  async function run(work: () => Promise<void>) { if (busy) return; setBusy(true); setMessage(""); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失敗。"); } finally { setBusy(false); } }
  async function selectedDoc(doc: Doc) {
    setSelected(doc); setType(doc.type); setWarehouseId(doc.warehouseId); setDestinationWarehouseId(doc.destinationWarehouseId ?? ""); setMemo(doc.memo);
    const line = doc.lines[0];
    await loadLocationData(tenantId, doc.warehouseId);
    if (line) { setProductId(line.productId); setLocationId(line.locationId); setTargetLocationId(line.targetLocationId ?? ""); setUnitId(line.unitId); setCount(String(line.quantity)); await loadUnits(tenantId, line.productId); setUnitId(line.unitId); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const line = { productId, locationId, ...(type === "transfer" ? { targetLocationId } : {}), unitId, quantity: Number(count) };
      let saved: Doc;
      if (selected?.status === "draft") saved = await request<Doc>(`${stockPath(tenantId)}/documents/${selected.id}`, "PATCH", { version: selected.version, memo, ...(type === "transfer" ? { destinationWarehouseId } : {}), lines: [line] });
      else saved = await request<Doc>(`${stockPath(tenantId)}/documents`, "POST", { type, warehouseId, ...(type === "transfer" ? { destinationWarehouseId } : {}), memo, lines: [line] });
      setSelected(saved); setMemo(saved.memo); await refreshDocs(); setMessage(`${typeName(saved.type)}草稿已儲存：${saved.number}`);
    });
  }
  async function cancel() { if (!selected) return; await run(async () => { const doc = await request<Doc>(`${stockPath(tenantId)}/documents/${selected.id}/cancel`, "POST", { version: selected.version }); setSelected(doc); await refreshDocs(); setMessage("草稿已取消，庫存沒有異動。"); }); }
  async function post() { if (!selected) return; await run(async () => { const doc = await request<Doc>(`${stockPath(tenantId)}/documents/${selected.id}/post`, "POST", { version: selected.version }, crypto.randomUUID()); setSelected(doc); await refreshDocs(); await loadLocationData(tenantId, doc.warehouseId); await loadQueries(); setMessage(`${typeName(doc.type)}已過帳，庫存異動已寫入。`); }); }
  async function updateFilters(patch: Partial<QueryFilters>) { const next = { ...queryFilters, ...patch }; setQueryFilters(next); await loadQueries(tenantId, next, 0, 0); }
  const pageLabel = (offset: number, total: number, count: number) => total ? `${offset + 1}–${offset + count} / ${total} 筆` : "0 筆";
  const filteredLocations = queryFilters.warehouseId ? allLocations.filter(item => item.warehouseId === queryFilters.warehouseId) : allLocations;
  const available = formBalances.find(item => item.productId === productId && item.locationId === locationId)?.quantity ?? 0;
  return <>
    {message && <p role="status" className="notice">{message}</p>}
    <label>工作空間<select aria-label="工作空間" disabled={busy} value={tenantId} onChange={event => void run(() => loadWorkspace(event.target.value))}><option value="">請選擇工作空間</option>{workspaces.map(item => <option key={item.tenant.id} value={item.tenant.id}>{item.tenant.name} · {item.role}</option>)}</select></label>
    {tenantId && <>
      <section><h2>跨倉調撥設定</h2><p>預設關閉。啟用後 Owner 可使用 WMS 調撥單；此設定不會把不同倉庫庫存合併成線上可售量。</p><label className="check"><input type="checkbox" checked={settings.allowInterWarehouseTransfers} disabled={busy || role !== "owner"} onChange={() => void toggleTransfers()} />允許跨倉調撥</label>{role !== "owner" && <p className="hint">只有 Owner 可以調整。</p>}</section>
      <nav aria-label="單據類型"><button type="button" disabled={busy} aria-pressed={type === "inbound"} onClick={() => { setType("inbound"); setSelected(null); setMemo(""); }}>入庫</button><button type="button" disabled={busy} aria-pressed={type === "outbound"} onClick={() => { setType("outbound"); setSelected(null); setMemo(""); }}>出庫</button><button type="button" disabled={busy || warehouses.length < 1} aria-pressed={type === "transfer"} onClick={() => { setType("transfer"); setSelected(null); setMemo(""); }}>調撥／移位</button><button type="button" disabled={busy || role !== "owner"} aria-pressed={type === "opening"} onClick={() => { setType("opening"); setSelected(null); setMemo(""); }}>期初入庫（Owner）</button></nav>
      <h2>{selected ? `${typeName(selected.type)}單 ${selected.number} · ${statusName(selected.status)}` : `新增${typeName(type)}草稿`}</h2>
      <form aria-label="庫存單據" onSubmit={submit}><fieldset disabled={busy || !draftEditable}>
        <label>倉庫<select required value={warehouseId} onChange={event => { const value = event.target.value; setWarehouseId(value); void run(() => loadLocationData(tenantId, value)); }}><option value="">請選倉庫</option>{warehouses.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label>儲位<select required value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">請選儲位</option>{locations.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        {type === "transfer" && <><label>目的倉庫<select required value={destinationWarehouseId} onChange={event => { const value = event.target.value; setDestinationWarehouseId(value); const first = allLocations.find(item => item.warehouseId === value && (value !== warehouseId || item.id !== locationId)); setTargetLocationId(first?.id ?? ""); }}><option value="">請選目的倉庫／移位倉庫</option>{warehouses.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label>目的儲位<select required value={targetLocationId} onChange={event => setTargetLocationId(event.target.value)}><option value="">請選目的儲位</option>{allLocations.filter(item => item.warehouseId === destinationWarehouseId && (destinationWarehouseId !== warehouseId || item.id !== locationId)).map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label></>}
        <label>商品<select required value={productId} onChange={event => { const value = event.target.value; setProductId(value); void run(() => loadUnits(tenantId, value)); }}><option value="">請選商品</option>{products.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <p>此商品此儲位現有量：{available} {products.find(item => item.id === productId)?.baseUnit ?? ""}</p>
        <label>數量單位<select required value={unitId} onChange={event => setUnitId(event.target.value)}><option value="">請選單位</option>{units.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}（1 = {item.factor} {products.find(product => product.id === productId)?.baseUnit}）</option>)}</select></label>
        <label>數量<input aria-label="數量" type="number" required min={1} max={2147483647} step={1} value={count} onChange={event => setCount(event.target.value)} /></label>
        <label>{type === "opening" ? "期初原因（必填）" : "備註（選填）"}<input required={type === "opening"} maxLength={500} value={memo} onChange={event => setMemo(event.target.value)} /></label>
        <button type="submit" disabled={!tenantId || !warehouseId || !locationId || type === "transfer" && (!destinationWarehouseId || !targetLocationId) || !productId || !unitId || type === "opening" && (!memo.trim() || role !== "owner")}>{selected?.status === "draft" ? "儲存草稿" : `建立${typeName(type)}草稿`}</button>
      </fieldset></form>
      {selected?.status === "draft" && <nav><button type="button" disabled={busy} onClick={() => void run(cancel)}>取消草稿</button><button type="button" disabled={busy || role !== "owner"} onClick={() => void run(post)}>Owner 過帳</button></nav>}
      {selected?.status === "posted" && !selected.reversalOfId && <div><label>沖銷原因<input required maxLength={200} value={reverseReason} onChange={event => setReverseReason(event.target.value)} /></label><button type="button" disabled={busy || role !== "owner" || !reverseReason.trim()} onClick={() => { if (!window.confirm(`確認沖銷 ${selected.number}？此操作會新增反向流水，不能撤回。`)) return; void run(async () => { const reversed = await request<Doc>(`${stockPath(tenantId)}/documents/${selected.id}/reverse`, "POST", { reason: reverseReason }, `reverse-${selected.id}`); setReverseReason(""); await refreshDocs(); await loadQueries(); setMessage(`已建立沖銷單 ${reversed.number}。`); }); }}>Owner 沖銷整張單據</button></div>}
      <h2>庫存單據</h2>
      {!documents.length && <p>目前沒有庫存單據。儲存入庫、出庫或調撥草稿後會列在這裡。</p>}
      {documents.map(doc => <article key={doc.id}><h3>{typeName(doc.type)} · {doc.number} · {statusName(doc.status)}</h3><p>{doc.lines.length} 項明細 · 版本 {doc.version} · {new Date(doc.createdAt).toLocaleString()}</p><button type="button" disabled={busy} onClick={() => void run(async () => selectedDoc(await request<Doc>(`${stockPath(tenantId)}/documents/${doc.id}`)))}>查看單據</button></article>)}
      <section aria-labelledby="balance-heading"><h2 id="balance-heading">目前庫存（大於零）</h2>
        <div className="form-grid" aria-label="庫存篩選">
          <label>商品篩選<select aria-label="庫存商品篩選" value={queryFilters.productId} disabled={busy} onChange={event => void run(() => updateFilters({ productId: event.target.value }))}><option value="">全部商品</option>{products.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <label>倉庫篩選<select aria-label="庫存倉庫篩選" value={queryFilters.warehouseId} disabled={busy} onChange={event => void run(() => updateFilters({ warehouseId: event.target.value, locationId: "" }))}><option value="">全部倉庫</option>{warehouses.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <label>儲位篩選<select aria-label="庫存儲位篩選" value={queryFilters.locationId} disabled={busy} onChange={event => void run(() => updateFilters({ locationId: event.target.value }))}><option value="">全部儲位</option>{filteredLocations.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        </div>
        {!balances.length && <p>目前篩選沒有庫存。</p>}
        <div className="table-scroll"><table><thead><tr><th>商品</th><th>倉庫</th><th>儲位</th><th>現有量</th></tr></thead><tbody>{balances.map(balance => { const product = products.find(item => item.id === balance.productId), warehouse = warehouses.find(item => item.id === balance.warehouseId), location = allLocations.find(item => item.id === balance.locationId); return <tr key={`${balance.productId}:${balance.warehouseId}:${balance.locationId}`}><td>{product?.code} · {product?.name}</td><td>{warehouse?.code} · {warehouse?.name}</td><td>{location?.code} · {location?.name}</td><td>{balance.quantity} {product?.baseUnit}</td></tr>; })}</tbody></table></div>
        <nav aria-label="庫存分頁"><span>{pageLabel(balanceOffset, balanceTotal, balances.length)}</span><button type="button" disabled={busy || balanceOffset === 0} onClick={() => void run(() => loadQueries(tenantId, queryFilters, Math.max(0, balanceOffset - 20), movementOffset))}>上一頁</button><button type="button" disabled={busy || balanceOffset + balances.length >= balanceTotal} onClick={() => void run(() => loadQueries(tenantId, queryFilters, balanceOffset + 20, movementOffset))}>下一頁</button></nav>
      </section>
      <section aria-labelledby="movement-heading"><h2 id="movement-heading">庫存異動明細</h2>
        {!movements.length && <p>目前篩選沒有異動記錄。</p>}
        <div className="table-scroll"><table><thead><tr><th>過帳時間</th><th>來源單據</th><th>商品</th><th>倉庫／儲位</th><th>異動量</th><th>操作者</th><th>詳情</th></tr></thead><tbody>{movements.map(item => <tr key={item.id}><td>{item.document.postedAt ? new Date(item.document.postedAt).toLocaleString() : new Date(item.createdAt).toLocaleString()}</td><td>{typeName(item.document.type)} · {item.document.number}</td><td>{item.product.code} · {item.product.name}</td><td>{item.warehouse.code} · {item.location.code}</td><td>{item.delta > 0 ? "+" : ""}{item.delta} {item.line.baseUnit}</td><td>{item.actorId.slice(0, 8)}</td><td><button type="button" disabled={busy} onClick={() => void run(async () => setSelectedMovement(await request<Movement>(`${stockPath(tenantId)}/movements/${item.id}`)))}>查看明細</button></td></tr>)}</tbody></table></div>
        {selectedMovement && <article aria-label="異動詳情"><h3>{typeName(selectedMovement.document.type)} · {selectedMovement.document.number}</h3><p>{selectedMovement.product.code} · {selectedMovement.product.name}，輸入 {selectedMovement.line.quantity} {selectedMovement.line.unitName} × {selectedMovement.line.factor} = {selectedMovement.line.baseQuantity} {selectedMovement.line.baseUnit}</p><p>{selectedMovement.document.type === "transfer" ? `來源：${warehouses.find(item => item.id === selectedMovement.document.warehouseId)?.name ?? ""} · ${allLocations.find(item => item.id === selectedMovement.line.locationId)?.name ?? ""}；目的：${warehouses.find(item => item.id === selectedMovement.document.destinationWarehouseId)?.name ?? ""} · ${allLocations.find(item => item.id === selectedMovement.line.targetLocationId)?.name ?? ""}` : `${selectedMovement.warehouse.name} · ${selectedMovement.location.name}`}；操作者 ID：{selectedMovement.actorId}</p><button type="button" onClick={() => setSelectedMovement(null)}>關閉明細</button></article>}
        <nav aria-label="異動分頁"><span>{pageLabel(movementOffset, movementTotal, movements.length)}</span><button type="button" disabled={busy || movementOffset === 0} onClick={() => void run(() => loadQueries(tenantId, queryFilters, balanceOffset, Math.max(0, movementOffset - 20)))}>上一頁</button><button type="button" disabled={busy || movementOffset + movements.length >= movementTotal} onClick={() => void run(() => loadQueries(tenantId, queryFilters, balanceOffset, movementOffset + 20))}>下一頁</button></nav>
      </section>
    </>}
  </>;
}
