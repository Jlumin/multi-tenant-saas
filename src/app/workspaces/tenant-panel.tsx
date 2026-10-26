"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

type Role = "owner" | "member";
interface Workspace { role: Role; tenant: { id: string; name: string; slug: string } }
interface Member { userId: string; role: Role; isActive: boolean; user: { name: string; email: string } }
interface Invitation { id: string; email: string; role: Role; expiresAt: string; acceptedAt: string | null; revokedAt: string | null }
interface Audit { id: string; action: string; actorId: string | null; createdAt: string }
interface Page<T> { items: T[]; total: number }
const messages: Record<string, string> = {
  unauthenticated: "請先登入並完成電子郵件驗證。", not_found: "工作空間不存在，或你沒有有效成員資格。",
  owner_required: "此操作需要 Owner 權限。", last_owner_required: "必須保留至少一位有效 Owner。",
  already_member: "此帳號已是有效成員。", invitation_delivery_failed: "寄送失敗，邀請已撤銷，請稍後重新邀請。",
  invitation_rate_limited: "邀請次數已達本時段上限，請稍後再試。", invalid_origin: "來源驗證失敗，請使用設定的網站網址。",
};

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/tenancy${path}`, { method, cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${messages[data.error?.code] ?? "無法完成要求，請重新整理或稍後再試。"} (${data.error?.requestId ?? response.status})`);
  return data as T;
}

function MemberEditor({ member, disabled, save }: { member: Member; disabled: boolean; save: (id: string, role: Role, active: boolean) => void }) {
  const [role, setRole] = useState<Role>(member.role);
  const [active, setActive] = useState(member.isActive);
  return <form onSubmit={e => { e.preventDefault(); save(member.userId, role, active); }} className="member-row">
    <fieldset disabled={disabled}><strong>{member.user.name}</strong><p>{member.user.email}</p>
      <label>角色<select value={role} onChange={e => setRole(e.target.value as Role)}><option value="owner">Owner</option><option value="member">Member</option></select></label>
      <label className="check"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />啟用成員資格</label>
      <button type="submit">儲存</button>
    </fieldset>
  </form>;
}

export function TenantPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Page<Member>>({ items: [], total: 0 });
  const [invitations, setInvitations] = useState<Page<Invitation>>({ items: [], total: 0 });
  const [events, setEvents] = useState<Page<Audit>>({ items: [], total: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void request<Page<Workspace>>("?limit=100").then(data => { if (!cancelled) { setWorkspaces(data.items); setTotal(data.total); } }).catch(error => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, []);

  async function refresh() {
    setSelected(null); setMembers({ items: [], total: 0 }); setInvitations({ items: [], total: 0 }); setEvents({ items: [], total: 0 });
    const data = await request<Page<Workspace>>("?limit=100"); setWorkspaces(data.items); setTotal(data.total);
  }
  async function load(workspace: Workspace) {
    setSelected(null); setEmail("");
    const detail = await request<{ role: Role }>(`/${workspace.tenant.id}`);
    if (detail.role === "owner") {
      const [m, i, e] = await Promise.all([request<Page<Member>>(`/${workspace.tenant.id}/members?limit=100`), request<Page<Invitation>>(`/${workspace.tenant.id}/invitations?limit=50`), request<Page<Audit>>(`/${workspace.tenant.id}/audit?limit=50`)]);
      setMembers(m); setInvitations(i); setEvents(e); setRevision(r => r + 1);
    }
    setSelected({ ...workspace, role: detail.role });
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "連線失敗。"); }
    finally { setBusy(false); }
  }
  async function invite(event: FormEvent) {
    event.preventDefault(); if (!selected) return;
    await run(async () => { await request(`/${selected.tenant.id}/invitations`, "POST", { email, role }); await load(selected); setMessage("邀請已寄送，24 小時內有效。請對方使用收件帳號登入並驗證後接受。"); });
  }

  return <>
    <nav aria-label="工作空間操作"><Link href="/sign-in">帳號與登入</Link><button disabled={busy} onClick={() => run(refresh)}>重新整理</button></nav>
    {message && <p role="status" className="notice">{message}</p>}
    {busy && <p role="status">處理中…</p>}
    <p>已加入的工作空間：顯示 {workspaces.length} / {total}。需要新租戶時，請聯絡維運管理員。</p>
    <nav aria-label="選擇工作空間">{workspaces.map(w => <button key={w.tenant.id} disabled={busy} onClick={() => run(() => load(w))}>{w.tenant.name} · {w.role}</button>)}</nav>
    {!workspaces.length && <p>目前沒有工作空間。可請 Owner 寄送邀請，再從邀請信加入。</p>}
    {selected && <section><h2>{selected.tenant.name} · {selected.role}</h2>
      {selected.role === "member" ? <p>你是此工作空間成員。成員管理只開放給 Owner，業務功能尚未啟用。</p> : <>
        <h3>邀請成員</h3><form onSubmit={invite}><fieldset disabled={busy}>
          <label>收件電子郵件<input type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label>加入角色<select value={role} onChange={e => setRole(e.target.value as Role)}><option value="member">Member</option><option value="owner">Owner（可管理成員與邀請）</option></select></label>
          <button type="submit">寄送邀請</button>
        </fieldset></form>
        <h3>成員（{members.items.length}/{members.total}）</h3>
        {members.items.map(member => <MemberEditor key={`${member.userId}-${revision}`} member={member} disabled={busy} save={(id, nextRole, isActive) => run(async () => { await request(`/${selected.tenant.id}/members/${id}`, "PATCH", { role: nextRole, isActive }); await refresh(); setMessage("權限已更新，請重新選擇工作空間。" ); })} />)}
        <h3>最近邀請（{invitations.items.length}/{invitations.total}）</h3>
        {invitations.items.map(invite => <article key={invite.id}><p>{invite.email} · {invite.role} · {invite.acceptedAt ? "已接受" : invite.revokedAt ? "已撤銷" : `到期：${invite.expiresAt}`}</p>
          {!invite.acceptedAt && !invite.revokedAt && <button disabled={busy} onClick={() => run(async () => { await request(`/${selected.tenant.id}/invitations/${invite.id}`, "POST", {}); await load(selected); })}>撤銷</button>}
        </article>)}
        <h3>最近審計（{events.items.length}/{events.total}）</h3><ul>{events.items.map(event => <li key={event.id}>{event.createdAt} · {event.action}</li>)}</ul>
      </>}
    </section>}
  </>;
}
