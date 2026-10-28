"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Member = { userId: string; role: "owner" | "member"; isActive: boolean; user: { name: string; email: string } };
type Employee = { id: string; userId: string; staffNumber: string | null; isActive: boolean; version: number; member: Member | null };
type Candidate = Member;
type Attendance = { id: string; userId: string; name?: string; staffNumber: string | null; clockInAt: string; clockOutAt: string | null; businessDate?: string; adjustments: { field: string; previousAt: string | null; correctedAt: string; reason: string; createdAt: string }[] };
type Workspace = { role: "owner" | "member"; tenant: { id: string; name: string } };
type Page<T> = { items: T[]; candidates?: Candidate[]; total: number; limit: number; offset: number; timezone: string; role?: "owner" | "member" };
type Current = { employeeActive: boolean; open: Attendance | null };
const errors: Record<string, string> = {
  unauthenticated: "請先登入並完成電子郵件驗證。", not_found: "找不到資料，或目前沒有此工作空間的存取權。", owner_required: "此操作需要 Owner 權限。", self_only: "Member 只能查閱本人的出勤。",
  invalid_origin: "來源驗證失敗，請使用設定的網站網址。", employee_exists: "此成員已建立員工資料。", staff_number_exists: "員工編號已使用。", version_conflict: "資料已被其他人更新，請重新整理。",
  already_clocked_in: "目前已有尚未下班的打卡紀錄。", not_clocked_in: "找不到尚未下班的紀錄。", attendance_conflict: "打卡衝突，請重新整理後確認紀錄。", invalid_adjustment_range: "更正時間順序不合理。", invalid_timestamp: "請輸入含 Z 的 UTC 時間，例如 2026-10-28T09:00:00Z。", invalid_timezone: "請輸入有效的 IANA 時區。",
  employee_has_open_attendance: "此員工仍有未下班紀錄，請先完成下班打卡或由 Owner 更正後再停用。",
};
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${errors[data.error?.code] ?? "操作失敗，請稍後重試。"} (${data.error?.requestId ?? response.status})`);
  return data as T;
}
function stamp(value: string | null, timezone: string) {
  return value ? new Intl.DateTimeFormat("zh-TW", { timeZone: timezone, dateStyle: "medium", timeStyle: "medium", hour12: false }).format(new Date(value)) : "尚未下班";
}

export function HrPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [ownerData, setOwnerData] = useState<Page<Employee> | null>(null);
  const [history, setHistory] = useState<Page<Attendance> | null>(null);
  const [current, setCurrent] = useState<Current>({ employeeActive: false, open: null });
  const [candidateId, setCandidateId] = useState(""); const [staffNumber, setStaffNumber] = useState("");
  const [timeZone, setTimeZone] = useState("Asia/Taipei"); const [correctId, setCorrectId] = useState(""); const [correctField, setCorrectField] = useState("clock_in"); const [correctedAt, setCorrectedAt] = useState(""); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(true); const [message, setMessage] = useState(""); const running = useRef(false);
  const workspace = workspaces.find(item => item.tenant.id === tenantId);

  useEffect(() => {
    let cancelled = false;
    void request<{ items: Workspace[] }>("/api/tenancy?limit=100").then(data => { if (!cancelled) setWorkspaces(data.items); }).catch(error => { if (!cancelled) setMessage(error.message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);
  async function reload(id: string) {
    setOwnerData(null); setHistory(null); setCurrent({ employeeActive: false, open: null }); setMessage("");
    if (!id) return;
    const selected = workspaces.find(item => item.tenant.id === id);
    if (selected?.role === "owner") {
      const [employees, attendance, settings, status] = await Promise.all([request<Page<Employee>>(`/api/hr/${id}/employees?limit=100`), request<Page<Attendance>>(`/api/hr/${id}/attendance?limit=100`), request<{ timeZone: string }>(`/api/hr/${id}/settings`), request<Current>(`/api/hr/${id}/current`)]);
      setOwnerData(employees); setHistory(attendance); setTimeZone(settings.timeZone); setCurrent(status);
    } else {
      const [status, attendance, settings] = await Promise.all([request<Current>(`/api/hr/${id}/current`), request<Page<Attendance>>(`/api/hr/${id}/attendance?limit=100`), request<{ timeZone: string }>(`/api/hr/${id}/settings`)]);
      setCurrent(status); setHistory(attendance); setTimeZone(settings.timeZone);
    }
  }
  async function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage("");
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失敗，請稍後重試。"); }
    finally { running.current = false; setBusy(false); }
  }
  async function addEmployee(event: FormEvent) {
    event.preventDefault(); await run(async () => { await request(`/api/hr/${tenantId}/employees`, "POST", { userId: candidateId, staffNumber }); await reload(tenantId); setCandidateId(""); setStaffNumber(""); setMessage("員工資料已建立。"); });
  }
  async function updateEmployee(employee: Employee, form: HTMLFormElement) {
    const data = new FormData(form);
    await request(`/api/hr/${tenantId}/employees/${employee.userId}`, "PATCH", { staffNumber: String(data.get("staffNumber") ?? ""), isActive: data.get("isActive") === "on", version: employee.version });
    await reload(tenantId); setMessage("員工資料已更新。");
  }
  async function punch(action: "clock-in" | "clock-out") {
    await run(async () => { await request(`/api/hr/${tenantId}/${action}`, "POST", { idempotencyKey: crypto.randomUUID() }); await reload(tenantId); setMessage(action === "clock-in" ? "已完成上班打卡。" : "已完成下班打卡。"); });
  }
  async function saveSettings(event: FormEvent) {
    event.preventDefault(); await run(async () => { await request(`/api/hr/${tenantId}/settings`, "PATCH", { timeZone }); await reload(tenantId); setMessage("時區已更新。"); });
  }
  async function adjust(event: FormEvent) {
    event.preventDefault(); await run(async () => { await request(`/api/hr/${tenantId}/attendance/${correctId}/adjust`, "POST", { field: correctField, correctedAt, reason }); await reload(tenantId); setCorrectId(""); setCorrectedAt(""); setReason(""); setMessage("出勤更正已記錄，原紀錄保留。"); });
  }

  return <section className="auth-panel">
    {message && <p role="status" className="notice">{message}</p>}
    <label>工作空間<select value={tenantId} disabled={busy} onChange={event => { const id = event.target.value; setTenantId(id); void run(() => reload(id)); }}><option value="">請選擇工作空間</option>{workspaces.map(item => <option key={item.tenant.id} value={item.tenant.id}>{item.tenant.name} · {item.role}</option>)}</select></label>
    {busy && <p role="status">載入中…</p>}
    {!workspaces.length && !busy && <p>目前沒有可用工作空間，請先加入工作空間。</p>}
    {tenantId && workspace?.role === "owner" && ownerData && <>
      <section><h2>我的打卡</h2>{current.employeeActive ? current.open ? <><p>上班時間：{stamp(current.open.clockInAt, timeZone)}</p><button disabled={busy} onClick={() => void punch("clock-out")}>下班打卡</button></> : <button disabled={busy} onClick={() => void punch("clock-in")}>上班打卡</button> : <p>你尚未加入此工作空間的員工名冊。</p>}</section>
      <section><h2>員工名冊</h2><p className="hint">目前僅能將此工作空間中已啟用的登入成員加入員工名冊。</p>
        <form onSubmit={addEmployee}><fieldset disabled={busy}><label>成員<select required value={candidateId} onChange={e => setCandidateId(e.target.value)}><option value="">選擇成員</option>{ownerData.candidates?.map(member => <option key={member.userId} value={member.userId}>{member.user.name} · {member.user.email}</option>)}</select></label><label>員工編號（選填）<input maxLength={40} value={staffNumber} onChange={e => setStaffNumber(e.target.value)} /></label><button type="submit">加入員工名冊</button></fieldset></form>
        {!ownerData.items.length && <p>尚無員工資料。</p>}
        {ownerData.items.map(employee => <article key={employee.id}><h3>{employee.member?.user.name ?? "已離開工作空間的成員"}</h3><p className="hint">{employee.member?.user.email ?? ""} · {employee.staffNumber || "無員工編號"}</p><form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; void run(() => updateEmployee(employee, form)); }}><fieldset disabled={busy}><label>員工編號<input name="staffNumber" defaultValue={employee.staffNumber ?? ""} maxLength={40} /></label><label className="check"><input type="checkbox" name="isActive" defaultChecked={employee.isActive} /> 可打卡</label><button type="submit">儲存員工資料</button></fieldset></form></article>)}
      </section>
      <form onSubmit={saveSettings}><h2>公司時區</h2><fieldset disabled={busy}><label>IANA 時區<input required value={timeZone} onChange={e => setTimeZone(e.target.value)} /></label><p className="hint">建議 Asia/Taipei。打卡時間以 UTC 保存，畫面依此時區顯示。</p><button type="submit">更新時區</button></fieldset></form>
    </>}
    {tenantId && workspace?.role === "member" && <section><h2>我的打卡</h2>{current.employeeActive ? current.open ? <><p>上班時間：{stamp(current.open.clockInAt, timeZone)}</p><button disabled={busy} onClick={() => void punch("clock-out")}>下班打卡</button></> : <button disabled={busy} onClick={() => void punch("clock-in")}>上班打卡</button> : <p>目前沒有員工名冊資料，請聯絡 Owner 建立。</p>}</section>}
    {tenantId && history && <section><h2>{workspace?.role === "owner" ? "全體出勤紀錄" : "我的出勤紀錄"}（{history.total}）</h2>{!history.items.length && <p>目前沒有出勤紀錄。</p>}{history.items.map(item => <article key={item.id}><h3>{workspace?.role === "owner" ? `${item.name ?? "員工"} · ${item.staffNumber ?? "無員工編號"}` : "出勤"}</h3><p>工作日期：{item.businessDate}<br />上班：{stamp(item.clockInAt, history.timezone)}<br />下班：{stamp(item.clockOutAt, history.timezone)}</p>{item.adjustments.length > 0 && <p className="hint">有 {item.adjustments.length} 筆更正紀錄，原始出勤保留。</p>}{workspace?.role === "owner" && <button disabled={busy} onClick={() => setCorrectId(item.id)}>更正此紀錄</button>}</article>)}</section>}
    {tenantId && workspace?.role === "owner" && correctId && <form onSubmit={adjust} className="delete-confirm"><h2>更正出勤時間</h2><fieldset disabled={busy}><label>欄位<select value={correctField} onChange={e => setCorrectField(e.target.value)}><option value="clock_in">上班</option><option value="clock_out">下班</option></select></label><label>修正後 UTC 時間（需含 Z）<input required value={correctedAt} onChange={e => setCorrectedAt(e.target.value)} placeholder="2026-10-28T09:00:00Z" /></label><label>更正原因<textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label><nav><button type="submit">記錄更正</button><button type="button" onClick={() => setCorrectId("")}>取消</button></nav></fieldset></form>}
  </section>;
}
