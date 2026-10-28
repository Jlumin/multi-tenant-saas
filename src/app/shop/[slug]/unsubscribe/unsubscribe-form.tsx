"use client";

import { useState } from "react";

export function UnsubscribeForm({ slug, token }: { slug: string; token: string }) {
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function unsubscribe() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/shop/${encodeURIComponent(slug)}/restock/unsubscribe`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await response.json();
      setMessage(response.ok ? "已完成退訂。" : data.error?.code === "not_found" ? "連結無效或已失效。" : "退訂失敗，請稍後重試。");
    } catch { setMessage("退訂失敗，請稍後重試。"); }
    finally { setBusy(false); }
  }
  return <section><h1>商品到貨通知退訂</h1><p>按下按鈕後，這個 email 將不再收到該商品的到貨通知。</p><button type="button" disabled={busy || !token} onClick={() => void unsubscribe()}>{busy ? "處理中…" : "確認退訂"}</button>{message && <p role="status">{message}</p>}</section>;
}
