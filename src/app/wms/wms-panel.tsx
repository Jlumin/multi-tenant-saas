"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Root = "products" | "warehouses";
type Kind = Root | "units" | "locations";
interface Master { id: string; code: string; name: string; isActive: boolean; version: number; baseUnit?: string; factor?: number; isBase?: boolean; isDefault?: boolean }
interface Page { items: Master[]; total: number; offset: number; limit: number; role: "owner" | "member" }
interface Workspace { role: string; tenant: { id: string; name: string } }
const empty: Page = { items: [], total: 0, offset: 0, limit: 10, role: "member" };
const titles = { products: "商品", warehouses: "倉庫", units: "包裝單位", locations: "儲位" };
const errors: Record<string, string> = {
  unauthenticated: "請先登入。", not_found: "資料不存在，或目前沒有存取權。", owner_required: "維護主檔需要 Owner 權限。",
  duplicate_code: "此範圍已使用相同代碼，請換一個代碼。停用的代碼也會保留。", reserved_code: "此代碼由系統保留。",
  invalid_code: "代碼限 1–40 個英數字、句點、連字號或底線，第一個字必須為英數字。", invalid_master: "請檢查名稱、代碼或基本單位的長度。",
  invalid_integer: "數量及換算比例必須是範圍內的正整數。", quantity_overflow: "換算數量超過上限，請減少數量。",
  version_conflict: "資料已被更新，請重新選取資料後再修改。", protected_record: "系統基本單位與未分配儲位不能修改或停用。",
  parent_inactive: "所屬商品或倉庫已停用，請先重新啟用。", master_inactive: "商品或單位已停用，無法試算。",
};
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${errors[data.error?.code] ?? "操作失敗，請檢查輸入或稍後重試。"} (${data.error?.requestId ?? response.status})`);
  return data as T;
}
function MasterForm({ kind, value, disabled, save }: { kind: Kind; value: Master | null; disabled: boolean; save: (body: Record<string, unknown>) => Promise<void> }) {
  const [code, setCode] = useState(value?.code ?? ""); const [name, setName] = useState(value?.name ?? "");
  const [baseUnit, setBaseUnit] = useState(value?.baseUnit ?? "個"); const [factor, setFactor] = useState("1"); const [active, setActive] = useState(value?.isActive ?? true);
  async function submit(event: FormEvent) {
    event.preventDefault();
    await save(value ? { name, isActive: active, version: value.version } : { name, code, ...(kind === "products" ? { baseUnit } : kind === "units" ? { factor: Number(factor) } : {}) });
  }
  return <form onSubmit={submit} aria-label={`${value ? "編輯" : "新增"}${titles[kind]}`}><fieldset disabled={disabled}>
    <h3>{value ? "編輯" : "新增"}{titles[kind]}</h3>
    <label>{kind === "products" ? "商品 SKU" : `${titles[kind]}代碼`}<input required maxLength={40} value={code} disabled={!!value} onChange={e => setCode(e.target.value)} /></label>
    <label>{titles[kind]}名稱<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
    {kind === "products" && <label>基本單位<input required maxLength={20} disabled={!!value} value={baseUnit} onChange={e => setBaseUnit(e.target.value)} /></label>}
    {kind === "units" && (value ? <p>每個包裝包含 {value.factor} 個基本單位。比例保留不覆寫，規格改變請停用後另建新代碼。</p> : <label>每個包裝的基本單位數量<input type="number" required min={1} max={1000000} step={1} value={factor} onChange={e => setFactor(e.target.value)} /></label>)}
    {value && <label className="check"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />啟用</label>}
    <button type="submit">{value ? "儲存" : "建立"}{titles[kind]}</button>
  </fieldset></form>;
}
function Paging({ page, busy, load }: { page: Page; busy: boolean; load: (offset: number) => void }) {
  return <nav aria-label="列表分頁"><button disabled={busy || page.offset === 0} onClick={() => load(Math.max(0, page.offset - 10))}>上一頁</button><span>第 {Math.floor(page.offset / 10) + 1} 頁，共 {page.total} 筆</span><button disabled={busy || page.offset + 10 >= page.total || page.offset >= 100000} onClick={() => load(page.offset + 10)}>下一頁</button></nav>;
}
export function WmsPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]), [workspaceTotal, setWorkspaceTotal] = useState(0);
  const [tenantId, setTenantId] = useState(""), [kind, setKind] = useState<Root>("warehouses");
  const [page, setPage] = useState<Page>(empty), [children, setChildren] = useState<Page>(empty);
  const [selected, setSelected] = useState<Master | null>(null), [child, setChild] = useState<Master | null>(null);
  const [busy, setBusy] = useState(true), [message, setMessage] = useState(""), [quantity, setQuantity] = useState("1"), [conversion, setConversion] = useState("");
  const running = useRef(false);
  const childKind = kind === "products" ? "units" : "locations";
  const prefix = `/api/wms/${tenantId}/${kind}`;
  useEffect(() => {
    let cancelled = false;
    void request<{ items: Workspace[]; total: number }>("/api/tenancy?limit=100").then(data => { if (!cancelled) { setWorkspaces(data.items); setWorkspaceTotal(data.total); } }).catch(error => { if (!cancelled) setMessage(error.message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);
  async function run(work: () => Promise<void>) {
    if (running.current) return; running.current = true; setBusy(true); setMessage("");
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失敗。"); }
    finally { running.current = false; setBusy(false); }
  }
  function clear() { setSelected(null); setChild(null); setChildren(empty); setConversion(""); }
  async function load(id: string, root: Root, offset = 0) {
    setPage(empty); clear(); if (!id) return;
    setPage(await request<Page>(`/api/wms/${id}/${root}?limit=10&offset=${offset}`));
  }
  async function open(id: string, offset = 0) {
    clear();
    const parent = await request<Master>(`${prefix}/${id}`);
    const entries = await request<Page>(`${prefix}/${id}/${childKind}?limit=10&offset=${offset}`);
    setSelected(parent); setChildren(entries);
  }
  async function saveParent(body: Record<string, unknown>) {
    await run(async () => {
      const value = await request<Master>(`${prefix}${selected ? `/${selected.id}` : ""}`, selected ? "PATCH" : "POST", body);
      await load(tenantId, kind); await open(value.id); setMessage(`${titles[kind]}已儲存。`);
    });
  }
  async function saveChild(body: Record<string, unknown>) {
    if (!selected) return;
    await run(async () => { await request(`${prefix}/${selected.id}/${childKind}${child ? `/${child.id}` : ""}`, child ? "PATCH" : "POST", body); await open(selected.id, children.offset); setMessage(`${titles[childKind]}已儲存。`); });
  }
  return <>
    <nav><Link href="/projects">專案管理</Link><Link href="/workspaces">工作空間與成員</Link><Link href="/sign-in">帳號與登入</Link></nav>
    <p className="hint">目前可維護主檔與試算包裝數量，庫存與入出庫功能將接續加入。</p>
    {message && <p role="status" className="notice">{message}</p>}
    <label>工作空間<select aria-label="工作空間" disabled={busy} value={tenantId} onChange={e => { const id = e.target.value; setTenantId(id); void run(() => load(id, kind)); }}><option value="">請選擇工作空間</option>{workspaces.map(w => <option key={w.tenant.id} value={w.tenant.id}>{w.tenant.name} · {w.role}</option>)}</select></label>
    <p className="hint">可選工作空間 {workspaces.length} / {workspaceTotal}。{!busy && !workspaces.length && "請先登入或聯絡管理員加入工作空間。"}</p>
    <nav aria-label="WMS 主檔類別">{(["warehouses", "products"] as const).map(root => <button key={root} aria-pressed={kind === root} disabled={busy || !tenantId} onClick={() => { setKind(root); void run(() => load(tenantId, root)); }}>{root === "products" ? "商品與包裝" : "倉庫與儲位"}</button>)}</nav>
    {busy && <p role="status">載入中…</p>}
    {tenantId && <>
      <h2>{titles[kind]}列表</h2><p>顯示啟用及停用資料。{page.role === "member" && "Member 可查詢；維護請由 Owner 操作。"}</p>
      <nav><button disabled={busy} onClick={() => void run(() => load(tenantId, kind, page.offset))}>重新整理</button>{page.role === "owner" && <button disabled={busy} onClick={clear}>新增{titles[kind]}</button>}</nav>
      {!page.items.length && !busy && <p>這一頁尚無{titles[kind]}資料。</p>}
      {page.items.map(item => <article key={item.id}><h3>{item.code} · {item.name}</h3><p>{item.isActive ? "啟用" : "已停用"}{item.baseUnit ? ` · 基本單位：${item.baseUnit}` : ""}</p><button disabled={busy} onClick={() => void run(() => open(item.id))}>查看{titles[kind]}：{item.code}</button></article>)}
      <Paging page={page} busy={busy} load={offset => void run(() => load(tenantId, kind, offset))} />
      {page.role === "owner" && <MasterForm key={`${tenantId}:${kind}:${selected?.id ?? "new"}:${selected?.version ?? 0}`} kind={kind} value={selected} disabled={busy} save={saveParent} />}
      {selected && <section aria-label={`${titles[childKind]}管理`}><h2>{selected.name} 的{titles[childKind]}</h2>
        {!selected.isActive && <p className="notice">所屬{titles[kind]}已停用，請先啟用再維護子資料或試算。</p>}
        {kind === "products" && <label>試算數量（整數，不影響庫存）<input type="number" min={1} max={2147483647} step={1} disabled={busy} value={quantity} onChange={e => { setQuantity(e.target.value); setConversion(""); }} /></label>}
        {conversion && <p role="status" className="notice">{conversion}</p>}
        {children.items.map(item => <article key={item.id}><h3>{item.code} · {item.name}</h3><p>{item.isActive ? "啟用" : "已停用"}{item.isBase || item.isDefault ? " · 系統預設（保護）" : ""}{item.factor ? ` · 1 ${item.name} = ${item.factor} ${selected.baseUnit}` : ""}</p>
          {page.role === "owner" && !item.isBase && !item.isDefault && <button disabled={busy || !selected.isActive} onClick={() => void run(async () => { setChild(null); setConversion(""); setChild(await request<Master>(`${prefix}/${selected.id}/${childKind}/${item.id}`)); })}>編輯{titles[childKind]}：{item.code}</button>}
          {kind === "products" && <button disabled={busy || !selected.isActive || !item.isActive} onClick={() => void run(async () => { setConversion(""); const result = await request<{ baseQuantity: number; baseUnit: string }>(`${prefix}/${selected.id}/convert`, "POST", { unitId: item.id, quantity: Number(quantity) }); setConversion(`${quantity} ${item.name} = ${result.baseQuantity} ${result.baseUnit}（僅試算）`); })}>試算：{item.code}</button>}
        </article>)}
        <Paging page={children} busy={busy} load={offset => void run(() => open(selected.id, offset))} />
        {page.role === "owner" && <><button disabled={busy || !selected.isActive} onClick={() => setChild(null)}>新增{titles[childKind]}</button><MasterForm key={`${selected.id}:${child?.id ?? "new"}:${child?.version ?? 0}`} kind={childKind} value={child} disabled={busy || !selected.isActive} save={saveChild} /></>}
      </section>}
    </>}
  </>;
}
