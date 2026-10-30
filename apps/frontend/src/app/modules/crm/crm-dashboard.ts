import { Component, input, OnChanges, OnInit, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Role = 'admin' | 'manager' | 'viewer';
interface Customer { id: string; code: string; name: string; email: string; phone: string; is_active: boolean; version: number; created_at: string }
interface Consent { id: string; purpose: string; granted: boolean; policy_version: string; recorded_at: string }
interface Page<T> { results: T[]; count: number }

@Component({
  selector: 'app-crm-dashboard',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="intro"><div><p class="eyebrow">PHASE 3 · CRM</p><h2>CRM 會員</h2><p>租戶內會員資料及同意紀錄。停用採保留歷史；同意或撤回都新增一筆紀錄。</p></div>
      <button type="button" (click)="refresh()" [disabled]="busy()">重新整理</button></section>
    @if (error()) { <p class="message error" role="alert">{{ error() }}</p> }
    @if (notice()) { <p class="message" role="status">{{ notice() }}</p> }
    @if (role() !== 'viewer') { <section><h3>新增會員</h3><form (ngSubmit)="create()"><fieldset class="form-grid" [disabled]="busy()">
      <label>會員代碼<input name="code" [(ngModel)]="code" maxlength="40" pattern="[A-Za-z0-9_-]+" required></label>
      <label>姓名<input name="name" [(ngModel)]="name" maxlength="120" required></label>
      <label>Email<input name="email" [(ngModel)]="email" maxlength="254" type="email"></label>
      <label>電話<input name="phone" [(ngModel)]="phone" maxlength="40"></label>
      <button class="primary" type="submit">新增會員</button>
    </fieldset></form></section> }
    <section><h3>會員名冊 <small>{{ customers().length }} / {{ count() }}</small></h3>
      <label>搜尋<input name="search" [(ngModel)]="search" (ngModelChange)="refresh()" placeholder="代碼、姓名、Email 或電話"></label>
      <div class="table-scroll"><table><thead><tr><th>代碼</th><th>姓名</th><th>Email／電話</th><th>狀態</th><th>操作</th></tr></thead><tbody>
        @for (customer of customers(); track customer.id) { <tr><td>{{ customer.code }}</td><td>{{ customer.name }}</td><td>{{ customer.email || '—' }}<br>{{ customer.phone || '—' }}</td><td>{{ customer.is_active ? '啟用' : '停用' }}</td><td>
          <button type="button" (click)="select(customer)" [disabled]="busy()">同意紀錄</button>
          @if (role() !== 'viewer') { <button type="button" (click)="toggle(customer)" [disabled]="busy()">{{ customer.is_active ? '停用' : '啟用' }}</button> }</td></tr> }
        @empty { <tr><td colspan="5">尚無會員資料。</td></tr> }
      </tbody></table></div>
    </section>
    @if (selected(); as customer) { <section><h3>{{ customer.code }} · {{ customer.name }} 的同意紀錄</h3>
      @if (role() !== 'viewer' && customer.is_active) { <div class="actions"><button type="button" (click)="record('marketing_email', true)" [disabled]="busy()">記錄 Email 行銷同意</button><button type="button" (click)="record('marketing_email', false)" [disabled]="busy()">記錄 Email 行銷撤回</button><button type="button" (click)="record('marketing_sms', true)" [disabled]="busy()">記錄簡訊行銷同意</button><button type="button" (click)="record('marketing_sms', false)" [disabled]="busy()">記錄簡訊行銷撤回</button></div> }
      <div class="table-scroll"><table><thead><tr><th>用途</th><th>結果</th><th>政策版本</th><th>紀錄時間</th></tr></thead><tbody>
        @for (event of consents(); track event.id) { <tr><td>{{ purposeName(event.purpose) }}</td><td>{{ event.granted ? '同意' : '撤回／不同意' }}</td><td>{{ event.policy_version }}</td><td>{{ event.recorded_at }}</td></tr> }
        @empty { <tr><td colspan="4">尚無同意紀錄。</td></tr> }
      </tbody></table></div>
    </section> }
  `,
  styles: [`
    :host { display:block; color:#163047; } section { background:white; border:1px solid #dce5eb; border-radius:12px; padding:1.25rem; margin:1rem 0; }
    .intro { display:flex; justify-content:space-between; align-items:center; gap:1rem; } h2 { margin:.2rem 0; } h3 { margin:.1rem 0 .8rem; }
    .eyebrow { color:#39746b; font-size:.8rem; letter-spacing:.12em; } .form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:.75rem; border:0; padding:0; margin:1rem 0; }
    label { display:flex; flex-direction:column; gap:.35rem; font-size:.88rem; } input,button { font:inherit; border:1px solid #bdcdd7; border-radius:6px; padding:.55rem .7rem; background:#fff; color:#163047; }
    button { cursor:pointer; margin:.15rem; } button:disabled { opacity:.6; cursor:wait; } .primary { background:#17675b; color:white; } .actions { margin:.75rem 0; }
    .table-scroll { overflow:auto; } table { border-collapse:collapse; width:100%; text-align:left; font-size:.85rem; } th,td { padding:.65rem; border-bottom:1px solid #e2e9ed; vertical-align:top; }
    .message { padding:.8rem; background:#e1f3ec; border-radius:8px; overflow-wrap:anywhere; } .error { color:#9c2c18; background:#fff0ec; }
    @media(max-width:600px) { .intro { align-items:flex-start; flex-direction:column; } }
  `],
})
export class CrmDashboard implements OnInit, OnChanges {
  readonly tenantId = input.required<string>();
  readonly role = input.required<Role>();
  readonly customers = signal<Customer[]>([]);
  readonly count = signal(0);
  readonly selected = signal<Customer | null>(null);
  readonly consents = signal<Consent[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  code = ''; name = ''; email = ''; phone = ''; search = '';
  private csrf = '';

  ngOnInit(): void { void this.refresh(); }
  ngOnChanges(changes: SimpleChanges): void { if (changes['tenantId'] && !changes['tenantId'].firstChange) void this.refresh(); }
  private base(): string { return `/api/v1/tenants/${this.tenantId()}/crm/customers/`; }
  private async request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-CSRFToken': this.csrf } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${data.error?.details ?? '無法完成要求'} (${data.error?.request_id ?? response.status})`);
    return data as T;
  }
  private async run(work: () => Promise<void>): Promise<void> {
    if (this.busy()) return; this.busy.set(true); this.error.set(''); this.notice.set('');
    try { await work(); } catch (e) { this.error.set(e instanceof Error ? e.message : '連線失敗。'); } finally { this.busy.set(false); }
  }
  async refresh(): Promise<void> {
    await this.run(async () => {
      this.csrf = (await this.request<{csrfToken:string}>('/api/v1/auth/csrf/')).csrfToken;
      const suffix = this.search.trim() ? `?search=${encodeURIComponent(this.search.trim())}` : '';
      const page = await this.request<Page<Customer>>(this.base() + suffix);
      this.customers.set(page.results); this.count.set(page.count);
      if (this.selected()) {
        const current = page.results.find(c => c.id === this.selected()!.id);
        if (current) await this.loadConsents(current); else { this.selected.set(null); this.consents.set([]); }
      }
    });
  }
  async create(): Promise<void> {
    await this.run(async () => { await this.request(this.base(), 'POST', { code: this.code, name: this.name, email: this.email, phone: this.phone }); this.code='';this.name='';this.email='';this.phone='';await this.reload();this.notice.set('會員已建立。'); });
  }
  async toggle(customer: Customer): Promise<void> {
    await this.run(async () => { await this.request(`${this.base()}${customer.id}/`, 'PATCH', { version: customer.version, is_active: !customer.is_active }); await this.reload(); });
  }
  async select(customer: Customer): Promise<void> { await this.run(async () => { this.selected.set(customer); await this.loadConsents(customer); }); }
  private async loadConsents(customer: Customer): Promise<void> {
    const detail = await this.request<Customer & {consents:Consent[]}>(`${this.base()}${customer.id}/`); this.consents.set(detail.consents);
  }
  async record(purpose: string, granted: boolean): Promise<void> {
    const customer = this.selected(); if (!customer) return;
    await this.run(async () => { await this.request(`${this.base()}${customer.id}/consents/`, 'POST', { purpose, granted, policy_version: 'v1' }); await this.loadConsents(customer); this.notice.set('同意狀態已新增至不可覆寫紀錄。'); });
  }
  private async reload(): Promise<void> {
    const suffix = this.search.trim() ? `?search=${encodeURIComponent(this.search.trim())}` : '';
    const page = await this.request<Page<Customer>>(this.base() + suffix); this.customers.set(page.results); this.count.set(page.count);
  }
  purposeName(value: string): string { return ({ marketing_email: 'Email 行銷', marketing_sms: '簡訊行銷', terms: '服務條款' } as Record<string,string>)[value] ?? value; }
}
