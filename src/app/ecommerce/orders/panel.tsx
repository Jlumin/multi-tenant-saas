"use client";

import { useEffect, useState } from "react";

type Workspace = { role: "owner" | "member"; tenant: { id: string; name: string } };
type Order = { id: string; orderNumber: string; status: string; currency: string; buyerName: string; buyerEmail: string; totalAmount: string; createdAt: string; lines: Array<{ productCode: string; productName: string; quantity: number; unitPrice: string; lineTotal: string }> };
type OrderPage = { items: Order[]; total: number; limit: number; offset: number };
export function OrdersPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]); const [tenant, setTenant] = useState(""); const [orders, setOrders] = useState<OrderPage | null>(null); const [selected, setSelected] = useState<Order | null>(null); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(true);
  useEffect(() => { let cancelled = false; void fetch("/api/tenancy?limit=100", { cache: "no-store" }).then(response => response.json()).then(data => { if (!cancelled) setWorkspaces(data.items ?? []); }).catch(() => { if (!cancelled) setMessage("無法載入工作空間。"); }).finally(() => { if (!cancelled) setBusy(false); }); return () => { cancelled = true; }; }, []);
  async function load(tenantId: string) {
    setTenant(tenantId); setOrders(null); setSelected(null); setMessage(""); if (!tenantId) return;
    const response = await fetch(`/api/ecommerce/${tenantId}/orders?limit=50`, { cache: "no-store" }); const data = await response.json();
    if (!response.ok) { setMessage(data.error?.code === "owner_required" ? "Member 目前沒有訂單檢視權限。" : data.error?.code === "not_found" ? "找不到工作空間或店面。" : "無法載入訂單。"); return; }
    setOrders(data);
  }
  async function detail(id: string) {
    const response = await fetch(`/api/ecommerce/${tenant}/orders/${id}`, { cache: "no-store" }); const data = await response.json();
    if (!response.ok) { setMessage(data.error?.code === "owner_required" ? "只有 Owner 可以查看訂單。" : "無法載入訂單明細。"); return; }
    setSelected(data);
  }
  return <>
    <label>工作空間<select disabled={busy} value={tenant} onChange={event => void load(event.target.value)}><option value="">請選擇工作空間</option>{workspaces.map(item => <option key={item.tenant.id} value={item.tenant.id}>{item.tenant.name} · {item.role}</option>)}</select></label>
    {busy && <p role="status">載入中…</p>}{message && <p role="status" className="notice">{message}</p>}{orders && <section><h2>訪客訂單（{orders.total}）</h2>{!orders.items.length && <p>目前沒有訂單。</p>}{orders.items.map(order => <article key={order.id}><h3>{order.orderNumber} · {order.status}</h3><p>{order.createdAt} · {order.currency} {order.totalAmount}</p><button type="button" onClick={() => void detail(order.id)}>查看買家與商品明細</button></article>)}</section>}
    {selected && <section><h2>{selected.orderNumber} 訂單明細</h2><p>買家：{selected.buyerName}</p><p>Email：<a href={`mailto:${selected.buyerEmail}`}>{selected.buyerEmail}</a></p><p>狀態：{selected.status} · {selected.currency} {selected.totalAmount}</p>{selected.lines.map((line, index) => <article key={`${line.productCode}-${index}`}><h3>{line.productName} · {line.productCode}</h3><p>{line.quantity} × {selected.currency} {line.unitPrice} = {selected.currency} {line.lineTotal}</p></article>)}<button type="button" onClick={() => setSelected(null)}>關閉明細</button></section>}
  </>;
}
