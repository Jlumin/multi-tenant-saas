"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

type Mode = "signin" | "signup" | "forgot" | "reset";
interface Session { user: { id: string; name: string; email: string }; }

export function AuthPanel({ initialMode = "signin" }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [session, setSession] = useState<Session | null>(null);
  const [google, setGoogle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    void fetch("/api/auth-capabilities").then(r => r.json()).then(data => setGoogle(data.google === true)).catch(() => {});
    void fetch("/api/auth/get-session", { cache: "no-store" }).then(async r => {
      if (r.ok) setSession(await r.json() as Session | null);
    }).catch(() => {});
  }, []);

  async function post(path: string, body: unknown) {
    const response = await fetch(`/api/auth/${path}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error("無法完成要求。請確認資料、驗證狀態及服務設定，或稍後重試。");
    return response.json();
  }

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage(""); setFailed(false);
    try { await work(); }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "連線失敗，請稍後重試。"); }
    finally { setBusy(false); setPassword(""); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      if (mode === "signin") {
        await post("sign-in/email", { email, password });
        const response = await fetch("/api/auth/get-session", { cache: "no-store" });
        if (!response.ok) throw new Error("登入狀態讀取失敗，請重新整理。");
        setSession(await response.json() as Session | null);
      } else if (mode === "signup") {
        await post("sign-up/email", { name, email, password, callbackURL: "/sign-in" });
        setMessage("若此電子郵件可註冊，請開啟驗證信中的連結，再回來登入。");
      } else if (mode === "forgot") {
        await post("request-password-reset", { email, redirectTo: "/reset-password" });
        setMessage("若此帳號可以重設密碼，將會收到重設連結。");
      } else {
        const token = new URLSearchParams(window.location.search).get("token");
        if (!token) throw new Error("缺少重設連結，請重新申請。");
        await post("reset-password", { token, newPassword: password });
        window.history.replaceState(null, "", "/sign-in");
        setMode("signin"); setMessage("密碼已更新，請重新登入。");
      }
    });
  }

  return <section className="auth-panel" aria-label="帳號登入">
    {session ? <>
      <h2>已登入</h2><p>{session.user.name} · {session.user.email}</p>
      <p>身分已驗證。工作空間存取權仍依有效成員資格決定。</p>
      <details><summary>提供給管理員的帳號識別碼</summary><code>{session.user.id}</code></details>
      <Link href="/workspaces">選擇工作空間</Link>
      <button disabled={busy} onClick={() => run(async () => { await post("sign-out", {}); setSession(null); })}>登出</button>
    </> : <>
      <h2>{{ signin: "登入帳號", signup: "建立帳號", forgot: "忘記密碼", reset: "重設密碼" }[mode]}</h2>
      {(mode === "signin" || mode === "signup") && <>
        <button type="button" disabled={!google || busy} onClick={() => run(async () => {
          const result = await post("sign-in/social", { provider: "google", callbackURL: "/sign-in" });
          if (typeof result.url !== "string" || new URL(result.url).origin !== "https://accounts.google.com") throw new Error("無效的 Google 授權網址。");
          window.location.assign(result.url);
        })}>使用 Google 登入</button>
        {!google && <p className="hint">Google 登入尚未由維運人員設定。</p>}
      </>}
      <form onSubmit={submit}><fieldset disabled={busy}>
        {mode === "signup" && <label>名稱<input value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="name" required /></label>}
        {mode !== "reset" && <label>電子郵件<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={254} required /></label>}
        {mode !== "forgot" && <label>密碼<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={mode === "signin" ? 1 : 12} maxLength={128} autoComplete={mode === "signin" ? "current-password" : "new-password"} required /></label>}
        <button type="submit">{busy ? "處理中…" : { signin: "登入", signup: "註冊並寄送驗證信", forgot: "申請重設", reset: "儲存新密碼" }[mode]}</button>
      </fieldset></form>
      <nav aria-label="帳號操作">
        <button disabled={busy} onClick={() => { setMode("signin"); setMessage(""); }}>返回登入</button>
        <button disabled={busy} onClick={() => { setMode("signup"); setMessage(""); }}>建立帳號</button>
        <button disabled={busy} onClick={() => { setMode("forgot"); setMessage(""); }}>忘記密碼</button>
      </nav>
    </>}
    {message && <p className={failed ? "error" : "notice"} role={failed ? "alert" : "status"}>{message}</p>}
  </section>;
}
