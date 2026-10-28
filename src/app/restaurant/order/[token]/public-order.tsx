"use client";

import { useEffect, useState } from "react";
type Menu={table:{id:string;label:string};restaurant:{name:string;currency:string};categories:{id:string;name:string;items:{id:string;code:string;name:string;description:string;price:string}[]}[]};
type Cart=Record<string,number>;
export function PublicOrder({token}:{token:string}){
 const [menu,setMenu]=useState<Menu|null>(null),[cart,setCart]=useState<Cart>({}),[message,setMessage]=useState("載入菜單中…"),[busy,setBusy]=useState(false);
 useEffect(()=>{let dead=false;void fetch(`/api/restaurant/public/${encodeURIComponent(token)}`,{cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error("此桌位 QR 無效或已停用。");if(!dead){setMenu(d);setMessage("")}}).catch(e=>{if(!dead)setMessage(e.message)});return()=>{dead=true}},[token]);
 async function submit(){if(!menu||busy)return;setBusy(true);setMessage("");try{const lines=Object.entries(cart).filter(([,quantity])=>quantity>0).map(([itemId,quantity])=>({itemId,quantity}));if(!lines.length)throw new Error("請先選擇餐點。");const response=await fetch(`/api/restaurant/public/${encodeURIComponent(token)}/orders`,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({lines})});const data=await response.json();if(!response.ok)throw new Error(data.error?.code??"送單失敗");setCart({});setMessage(`訂單 ${data.orderNumber} 已送出，總計 ${new Intl.NumberFormat("zh-TW",{style:"currency",currency:data.currency}).format(Number(data.totalAmount))}。`)}catch(e){setMessage(e instanceof Error?e.message:"送單失敗")}finally{setBusy(false)}}
 if(message&&!menu)return <p role="status">{message}</p>;if(!menu)return null;
 return <section><p>{menu.restaurant.name} · {menu.table.label}</p>{message&&<p role="status" className="notice">{message}</p>}{menu.categories.map(c=><section key={c.id}><h2>{c.name}</h2>{c.items.map(i=><article key={i.id}><h3>{i.name}</h3><p>{i.description}</p><p>{new Intl.NumberFormat("zh-TW",{style:"currency",currency:menu.restaurant.currency}).format(Number(i.price))}</p><label>數量<input type="number" min="0" max="99" step="1" value={cart[i.id]??0} onChange={e=>setCart(x=>({...x,[i.id]:Number(e.target.value)}))}/></label></article>)}</section>)}<button disabled={busy} onClick={()=>void submit()}>送出訂單</button></section>;
}
