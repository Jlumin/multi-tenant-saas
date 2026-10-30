import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WmsDashboard } from './modules/wms/wms-dashboard';
import { CrmDashboard } from './modules/crm/crm-dashboard';
import { EcommerceDashboard } from './modules/ecommerce/ecommerce-dashboard';
import { HrDashboard } from './modules/hr/hr-dashboard';
import { RestaurantDashboard, QrOrdering } from './modules/restaurant/restaurant-dashboard';

type Role = 'admin' | 'manager' | 'viewer';
interface TenantMembership { tenant_id: string; tenant_name: string; role: Role }
interface Identity { username: string; memberships: TenantMembership[] }
interface Store { id: string; name: string; code: string; is_active: boolean }
interface Member { id: string; username: string; role: Role; is_active: boolean; store_ids: string[] }
interface Audit { id: string; action: string; actor_id: number | null; target_id: string; request_id: string; created_at: string }
interface Page<T> { results: T[]; count: number; next: string | null }

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, WmsDashboard, CrmDashboard, EcommerceDashboard, HrDashboard, RestaurantDashboard, QrOrdering],
  templateUrl: './app.html',
})
export class App {
  readonly identity = signal<Identity | null>(null);
  readonly selected = signal<TenantMembership | null>(null);
  readonly qrToken = signal<string | null>(new URLSearchParams(window.location.search).get('qr'));
  readonly moduleTab = signal<'platform' | 'wms' | 'crm' | 'ecommerce' | 'hr' | 'restaurant'>('platform');
  readonly stores = signal<Store[]>([]);
  readonly members = signal<Member[]>([]);
  readonly events = signal<Audit[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly auditCount = signal(0);
  readonly storeCount = signal(0);
  readonly memberCount = signal(0);
  readonly roleNames: Record<Role, string> = { admin: '租戶管理員', manager: '門店管理員', viewer: '檢視者' };
  username = '';
  password = '';
  storeName = '';
  storeCode = '';
  memberUsername = '';
  memberPassword = '';
  memberRole: Role = 'viewer';
  private csrfToken = '';

  constructor() { if (!this.qrToken()) void this.restore(); }

  private async request<T>(url: string, method = 'GET', data?: unknown): Promise<T> {
    const response = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'X-CSRFToken': this.csrfToken } : {}) },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 403 && this.identity()) {
        // Keep server-side denial authoritative. The refresh button rechecks membership.
        this.notice.set('權限可能已變更；請重新整理或重新登入。');
      }
      const details = payload.error?.details ?? '無法完成要求';
      throw new Error(`${typeof details === 'string' ? details : JSON.stringify(details)} (${payload.error?.request_id ?? response.status})`);
    }
    return payload as T;
  }

  private async guard(work: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try { await work(); } catch (error) { this.error.set(error instanceof Error ? error.message : '連線失敗，請稍後重試。'); }
    finally { this.busy.set(false); }
  }

  private async restore(): Promise<void> {
    await this.guard(async () => {
      this.csrfToken = (await this.request<{ csrfToken: string }>('/api/v1/auth/csrf/')).csrfToken;
      const response = await fetch('/api/v1/auth/me/', { credentials: 'same-origin' });
      if (response.status === 403) return;
      if (!response.ok) throw new Error('無法讀取登入狀態。');
      const me = await response.json() as Identity;
      this.identity.set(me);
      if (me.memberships[0]) await this.loadTenant(me.memberships[0]);
    });
  }

  async login(): Promise<void> {
    await this.guard(async () => {
      try {
        this.csrfToken = (await this.request<{ csrfToken: string }>('/api/v1/auth/csrf/')).csrfToken;
        const result = await this.request<{ csrfToken: string }>('/api/v1/auth/login/', 'POST', { username: this.username, password: this.password });
        this.csrfToken = result.csrfToken;
        const me = await this.request<Identity>('/api/v1/auth/me/');
        this.identity.set(me);
        if (me.memberships[0]) await this.loadTenant(me.memberships[0]);
      } finally { this.password = ''; }
    });
  }

  async logout(): Promise<void> {
    await this.guard(async () => {
      await this.request('/api/v1/auth/logout/', 'POST', {});
      this.identity.set(null); this.selected.set(null); this.moduleTab.set('platform'); this.clearTenant();
      this.memberPassword = ''; this.password = '';
      this.csrfToken = (await this.request<{ csrfToken: string }>('/api/v1/auth/csrf/')).csrfToken;
    });
  }

  selectModule(tab: 'platform' | 'wms' | 'crm' | 'ecommerce' | 'hr' | 'restaurant'): void { this.moduleTab.set(tab); }

  private clearTenant(): void {
    this.stores.set([]); this.members.set([]); this.events.set([]);
    this.storeCount.set(0); this.memberCount.set(0); this.auditCount.set(0);
  }

  private path(tenant: TenantMembership): string { return `/api/v1/tenants/${tenant.tenant_id}`; }

  private async loadTenant(tenant: TenantMembership): Promise<void> {
    this.selected.set(tenant); this.clearTenant();
    const base = this.path(tenant);
    const [stores, members, events] = await Promise.all([
      this.request<Page<Store>>(`${base}/stores/?limit=100`),
      tenant.role === 'admin' ? this.request<Page<Member>>(`${base}/members/?limit=100`) : null,
      tenant.role === 'admin' ? this.request<Page<Audit>>(`${base}/audit/?limit=50`) : null,
    ]);
    this.stores.set(stores.results); this.storeCount.set(stores.count);
    this.members.set(members?.results ?? []); this.memberCount.set(members?.count ?? 0);
    this.events.set(events?.results ?? []); this.auditCount.set(events?.count ?? 0);
  }

  async selectTenant(tenant: TenantMembership): Promise<void> {
    await this.guard(async () => { this.storeName = ''; this.storeCode = ''; this.memberUsername = ''; this.memberPassword = ''; await this.loadTenant(tenant); });
  }

  async refresh(): Promise<void> {
    await this.guard(async () => {
      const me = await this.request<Identity>('/api/v1/auth/me/');
      this.identity.set(me);
      const tenant = me.memberships.find(m => m.tenant_id === this.selected()?.tenant_id) ?? me.memberships[0];
      this.selected.set(null); this.clearTenant();
      if (tenant) await this.loadTenant(tenant);
    });
  }

  async createStore(): Promise<void> {
    const tenant = this.selected(); if (!tenant) return;
    await this.guard(async () => {
      await this.request(`${this.path(tenant)}/stores/`, 'POST', { name: this.storeName, code: this.storeCode });
      this.storeName = ''; this.storeCode = ''; await this.loadTenant(tenant);
      this.notice.set('門店已建立。');
    });
  }

  async toggleStore(store: Store): Promise<void> {
    const tenant = this.selected(); if (!tenant) return;
    await this.guard(async () => {
      await this.request(`${this.path(tenant)}/stores/${store.id}/`, 'PATCH', { is_active: !store.is_active });
      await this.loadTenant(tenant);
    });
  }

  async createMember(): Promise<void> {
    const tenant = this.selected(); if (!tenant) return;
    await this.guard(async () => {
      try {
        await this.request(`${this.path(tenant)}/members/`, 'POST', { username: this.memberUsername, password: this.memberPassword, role: this.memberRole });
        this.memberUsername = ''; await this.loadTenant(tenant);
        this.notice.set('帳號已建立；非管理員需另指派門店。請透過安全管道交付初始密碼。');
      } finally { this.memberPassword = ''; }
    });
  }

  setStoreAccess(member: Member, storeId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    member.store_ids = checked ? [...new Set([...member.store_ids, storeId])] : member.store_ids.filter(id => id !== storeId);
  }

  async saveMember(member: Member): Promise<void> {
    const tenant = this.selected(); if (!tenant) return;
    await this.guard(async () => {
      await this.request(`${this.path(tenant)}/members/${member.id}/`, 'PATCH', { role: member.role, is_active: member.is_active, store_ids: member.store_ids });
      await this.refreshAfterMemberChange(tenant);
      this.notice.set('成員權限已儲存。');
    });
  }

  private async refreshAfterMemberChange(previous: TenantMembership): Promise<void> {
    const me = await this.request<Identity>('/api/v1/auth/me/'); this.identity.set(me);
    const tenant = me.memberships.find(m => m.tenant_id === previous.tenant_id);
    this.clearTenant(); this.selected.set(null);
    if (tenant) await this.loadTenant(tenant);
  }
}
