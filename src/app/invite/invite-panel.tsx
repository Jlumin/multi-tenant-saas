"use client";

import { useState } from "react";
import Link from "next/link";

export function InvitePanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);
  async function accept() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const token = new URLSearchParams(window.location.search).get("token");
      if (!token) throw new Error("缺少邀請連結，請從原邀請信開啟。");
      const response = await fetch("/api/tenancy/accept", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      if (!response.ok) throw new Error(response.status === 401 ? "請先登入收件帳號並完成電子郵件驗證，再重新開啟原邀請連結。" : "邀請無效、過期、已使用，或目前帳號與收件地址不符。請聯絡 Owner 重新邀請。");
      window.history.replaceState(null, "", "/invite"); setAccepted(true); setMessage("已加入工作空間。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "連線失敗，請稍後再試。"); }
    finally { setBusy(false); }
  }
  return <><p>請先使用收件帳號登入，並完成電子郵件驗證。首次註冊後，請重新開啟原邀請信。</p>
    <Link href="/sign-in">登入／註冊</Link>{!accepted && <button disabled={busy} onClick={accept}>{busy ? "處理中…" : "接受邀請"}</button>}
    {message && <p role="status">{message}</p>}{accepted && <Link href="/workspaces">進入工作空間</Link>}
  </>;
}
