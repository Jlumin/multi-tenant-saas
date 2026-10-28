"use client";

import { useEffect, useState } from "react";

type Workspace = { role: "owner" | "member"; tenant: { id: string; name: string } };
type Order = { id: string; orderNumber: string; status: string; reservationStatus: string; currency: string; buyerName: string; buyerEmail: string; totalAmount: string; createdAt: string; lines: Array<{ productCode: string; productName: string; quantity: number; unitPrice: string; lineTotal: string }> };
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
  async function inventoryAction(action: "fulfill" | "release") {
    if (!selected) return;
    const prompt = action === "fulfill" ? "請確認商品已實際出貨。出庫後會扣減 WMS 庫存，是否繼續？" : "請確認商品未出貨且實物仍在此出貨倉。若商品曾出貨退回，請先完成 WMS 退回入庫，是否繼續？";
    if (!window.confirm(prompt)) return;
    setBusy(true); setMessage("");
    try {
      const field = action === "fulfill" ? "shipmentConfirmed" : "stockStillInWarehouseConfirmed";
      const response = await fetch(`/api/ecommerce/${tenant}/orders/${selected.id}/${action}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.code ?? "service_unavailable");
      setMessage(action === "fulfill" ? "已確認出貨，WMS 庫存已過帳扣減。" : "預留已釋放；只有已完成 WMS 入庫的數量才會重新可售。");
      await load(tenant);
    } catch (error) { setMessage(`操作失敗：${error instanceof Error ? error.message : "service_unavailable"}`); }
    finally { setBusy(false); }
  }
  return <>
    <label>工作空間<select disabled={busy} value={tenant} onChange={event => void load(event.target.value)}><option value="">請選擇工作空間</option>{workspaces.map(item => <option key={item.tenant.id} value={item.tenant.id}>{item.tenant.name} · {item.role}</option>)}</select></label>
    {busy && <p role="status">載入中…</p>}{message && <p role="status" className="notice">{message}</p>}{orders && <section><h2>訪客訂單（{orders.total}）</h2>{!orders.items.length && <p>目前沒有訂單。</p>}{orders.items.map(order => <article key={order.id}><h3>{order.orderNumber} · {order.status}</h3><p>{order.createdAt} · {order.currency} {order.totalAmount} · 庫存預留：{order.reservationStatus}</p><button type="button" onClick={() => void detail(order.id)}>查看買家與商品明細</button></article>)}</section>}
    {selected && <section><h2>{selected.orderNumber} 訂單明細</h2><p>買家：{selected.buyerName}</p><p>Email：<a href={`mailto:${selected.buyerEmail}`}>{selected.buyerEmail}</a></p><p>狀態：{selected.status} · {selected.currency} {selected.totalAmount} · 庫存預留：{selected.reservationStatus}</p>{selected.lines.map((line, index) => <article key={`${line.productCode}-${index}`}><h3>{line.productName} · {line.productCode}</h3><p>{line.quantity} × {selected.currency} {line.unitPrice} = {selected.currency} {line.lineTotal}</p></article>)}{selected.reservationStatus === "active" && <><p className="hint">出貨請在實際交寄後確認；僅可對確認尚未出貨且仍在倉庫的商品釋放預留。已出貨退回請先完成 WMS 退回入庫。</p><button type="button" disabled={busy} onClick={() => void inventoryAction("fulfill")}>確認已出貨並過帳</button><button type="button" disabled={busy} onClick={() => void inventoryAction("release")}>確認未出貨且仍在倉庫，釋放預留</button></>}<button type="button" onClick={() => setSelected(null)}>關閉明細</button></section>}
  </>;
}
