"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

interface Workspace { role: "owner" | "member"; tenant: { id: string; name: string } }
interface Project { id: string; name: string; description: string; createdAt: string; updatedAt: string; version: number }
interface Page { items: Project[]; total: number; limit: number; offset: number; role: "owner" | "member" }
const empty: Page = { items: [], total: 0, limit: 10, offset: 0, role: "member" };
const errors: Record<string, string> = {
  unauthenticated: "請先登入並完成電子郵件驗證。", not_found: "找不到專案，或目前沒有此工作空間的存取權。",
  owner_required: "刪除需要 Owner 權限。", version_conflict: "專案已被其他人更新，請重新載入專案後再編輯。你的輸入尚未送出。",
  invalid_project: "請填入 1–120 字的名稱，描述最多 2000 字。", invalid_origin: "來源驗證失敗，請使用設定的網站網址。",
};
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${errors[data.error?.code] ?? "操作失敗，請稍後重試。"} (${data.error?.requestId ?? response.status})`);
  return data as T;
}

export function ProjectPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceTotal, setWorkspaceTotal] = useState(0);
  const [tenantId, setTenantId] = useState("");
  const [page, setPage] = useState<Page>(empty);
  const [selected, setSelected] = useState<Project | null>(null);
  const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(true); const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void request<{ items: Workspace[]; total: number }>("/api/tenancy?limit=100").then(data => {
      if (!cancelled) { setWorkspaces(data.items); setWorkspaceTotal(data.total); }
    }).catch(error => { if (!cancelled) setMessage(error.message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);
  function resetEditor() { setSelected(null); setName(""); setDescription(""); setConfirmDelete(false); }
  async function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage("");
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失敗，請稍後重試。"); }
    finally { running.current = false; setBusy(false); }
  }
  async function load(id: string, offset = 0) {
    // Clear the old tenant's data before any request for a different scope.
    setPage(empty); resetEditor();
    if (!id) return;
    const next = await request<Page>(`/api/projects/${id}?limit=10&offset=${offset}`);
    setPage(next);
  }
  async function open(id: string) {
    const project = await request<Project>(`/api/projects/${tenantId}/${id}`);
    setSelected(project); setName(project.name); setDescription(project.description); setConfirmDelete(false);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const updated = await request<Project>(`/api/projects/${tenantId}${selected ? `/${selected.id}` : ""}`, selected ? "PATCH" : "POST", { name, description, ...(selected ? { version: selected.version } : {}) });
      await load(tenantId); setSelected(updated); setName(updated.name); setDescription(updated.description); setMessage(selected ? "專案已更新。" : "專案已建立。");
    });
  }
  return <>
    <nav><Link href="/workspaces">工作空間與成員</Link><Link href="/sign-in">帳號與登入</Link></nav>
    {message && <p role="status" className="notice">{message}</p>}
    <label>工作空間<select value={tenantId} disabled={busy} onChange={event => {
      const id = event.target.value; setTenantId(id); void run(() => load(id));
    }}><option value="">請選擇工作空間</option>{workspaces.map(w => <option key={w.tenant.id} value={w.tenant.id}>{w.tenant.name} · {w.role}</option>)}</select></label>
    <p className="hint">可選工作空間 {workspaces.length} / {workspaceTotal}。{!workspaces.length && !busy && "目前沒有工作空間，請先聯絡管理員。"}</p>
    {busy && <p role="status">載入中…</p>}
    {tenantId && <>
      <nav aria-label="專案操作"><button disabled={busy} onClick={() => void run(() => load(tenantId))}>重新整理列表</button><button disabled={busy} onClick={resetEditor}>新增專案</button></nav>
      <section aria-label="專案列表" aria-busy={busy}>
        <h2>專案列表（{page.total}）</h2>
        {!page.items.length && !busy && <p>這一頁沒有專案，可新增專案或返回上一頁。</p>}
        {page.items.map(project => <article key={project.id}><h3>{project.name}</h3><p className="project-description">{project.description || "尚無描述"}</p><p className="hint">更新：{new Date(project.updatedAt).toLocaleString("zh-TW")}</p><button disabled={busy} onClick={() => void run(() => open(project.id))}>查看／編輯：{project.name}</button></article>)}
        <nav aria-label="專案分頁"><button disabled={busy || page.offset === 0} onClick={() => void run(() => load(tenantId, Math.max(0, page.offset - 10)))}>上一頁</button><span>第 {Math.floor(page.offset / 10) + 1} 頁 · 共 {page.total} 筆</span><button disabled={busy || page.offset + page.limit >= page.total} onClick={() => void run(() => load(tenantId, page.offset + 10))}>下一頁</button></nav>
      </section>
      <section aria-label="專案編輯"><h2>{selected ? "查看／編輯專案" : "新增專案"}</h2>
        {selected && <p className="hint">版本 {selected.version} · 建立：{new Date(selected.createdAt).toLocaleString("zh-TW")}</p>}
        <form onSubmit={save}><fieldset disabled={busy}><label>專案名稱<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label><label>專案描述<textarea maxLength={2000} rows={5} value={description} onChange={e => setDescription(e.target.value)} /></label><button type="submit">{selected ? "儲存專案" : "建立專案"}</button></fieldset></form>
        {selected && <nav><button disabled={busy} onClick={() => void run(() => open(selected.id))}>重新載入專案</button>{page.role === "owner" && <button disabled={busy} onClick={() => setConfirmDelete(true)}>刪除專案</button>}</nav>}
        {selected && confirmDelete && <section className="delete-confirm" aria-label="刪除確認"><p>確定刪除「{selected.name}」？刪除後不再出現在列表中，資料與審計紀錄會保留，目前不提供自行還原。</p><nav><button disabled={busy} onClick={() => void run(async () => { await request(`/api/projects/${tenantId}/${selected.id}`, "DELETE", { version: selected.version }); await load(tenantId); setMessage("專案已刪除，紀錄已保留。"); })}>確認刪除</button><button disabled={busy} onClick={() => setConfirmDelete(false)}>取消刪除</button></nav></section>}
      </section>
    </>}
  </>;
}
