import { Component, input, OnChanges, OnInit, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Role = 'admin' | 'manager' | 'viewer';
interface Page<T> { results: T[]; count: number }
interface Product { id: string; code: string; name: string; is_active: boolean }
interface Warehouse { id: string; code: string; name: string; is_active: boolean }
interface Customer { id: string; code: string; name: string; is_active: boolean }
interface Listing { id: string; product_id: string; warehouse_id: string; product_code: string; title: string; category:string; currency: string; price: string; available_quantity: number; product_image_url:string|null; is_active: boolean }
interface Order { id: string; order_code: string; customer_name: string; status: string; currency: string; total_amount: string; payment_status: string; payment_provider: string; lines: Array<{product_code:string;title:string;warehouse_id:string;quantity:number;unit_price:string;line_total:string}> }

@Component({
  selector: 'app-ecommerce-dashboard',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="intro"><div><p class="eyebrow">PHASE 3 · E-COMMERCE</p><h2>購物商品與訂單 sandbox</h2><p>每個商品上架指定單一出貨倉庫；下單預留庫存，sandbox 付款過帳後才扣庫。</p></div><button type="button" (click)="refresh()" [disabled]="busy()">重新整理</button></section>
    <p class="notice">內部驗證介面：目前僅租戶登入成員可存取，sandbox 付款不會連接金流，也不會收取真實款項。</p>
    @if (error()) { <p class="message error" role="alert">{{ error() }}</p> }
    @if (notice()) { <p class="message" role="status">{{ notice() }}</p> }
    @if (role() === 'admin') {
      <section><h3>建立商品上架</h3><form (ngSubmit)="createListing()"><fieldset class="grid" [disabled]="busy()">
        <label>WMS 商品<select name="product" [(ngModel)]="productId" required><option value="">選擇商品</option>@for (p of products(); track p.id) { @if (p.is_active) { <option [value]="p.id">{{ p.code }} · {{ p.name }}</option> } }</select></label>
        <label>出貨倉庫<select name="warehouse" [(ngModel)]="warehouseId" required><option value="">選擇倉庫</option>@for (w of warehouses(); track w.id) { @if (w.is_active) { <option [value]="w.id">{{ w.code }} · {{ w.name }}</option> } }</select></label>
        <label>網站標題<input name="title" [(ngModel)]="title" maxlength="160" required></label>
        <label>商品分類<input name="category" [(ngModel)]="category" maxlength="80" placeholder="例如：汽車零件、電裝"></label>
        <label>價格（TWD）<input name="price" type="number" [(ngModel)]="price" min="0" step="0.01" required></label>
        <button class="primary" type="submit">上架</button>
      </fieldset></form></section>
      <section><h3>建立訂單 sandbox</h3><form (ngSubmit)="createOrder()"><fieldset class="grid" [disabled]="busy()">
        <label>CRM 會員<select name="customer" [(ngModel)]="customerId" required><option value="">選擇會員</option>@for (c of customers(); track c.id) { @if (c.is_active) { <option [value]="c.id">{{ c.code }} · {{ c.name }}</option> } }</select></label>
        <label>上架商品／倉庫<select name="listing" [(ngModel)]="listingId" required><option value="">選擇上架商品</option>@for (listing of listings(); track listing.id) { @if (listing.is_active) { <option [value]="listing.id">{{ listing.title }} · {{ listing.currency }} {{ listing.price }} · 可售 {{ listing.available_quantity }}</option> } }</select></label>
        <label>數量（整數）<input name="quantity" type="number" [(ngModel)]="quantity" min="1" step="1" required></label>
        <button class="primary" type="submit">建立待付款訂單並預留庫存</button>
      </fieldset></form></section>
    }
    <section><h3>上架清單</h3><div class="table-scroll"><table><thead><tr><th>圖片</th><th>商品</th><th>分類</th><th>倉庫</th><th>價格</th><th>可售庫存</th><th>狀態</th></tr></thead><tbody>
      @for (listing of listings(); track listing.id) { <tr><td>@if(listing.product_image_url){<img class="product-image" [src]="listing.product_image_url" [alt]="listing.title">}@else{尚無圖片}</td><td>{{ listing.product_code }} · {{ listing.title }}</td><td>{{ listing.category || '—' }}</td><td>{{ warehouseName(listing.warehouse_id) }}</td><td>{{ listing.currency }} {{ listing.price }}</td><td>{{ listing.available_quantity }}</td><td>{{ listing.is_active ? '上架' : '下架' }}</td></tr> }
      @empty { <tr><td colspan="7">尚無商品上架。</td></tr> }
    </tbody></table></div></section>
    <section><h3>訂單</h3><div class="table-scroll"><table><thead><tr><th>訂單</th><th>會員</th><th>品項</th><th>金額</th><th>訂單／付款狀態</th><th>操作</th></tr></thead><tbody>
      @for (order of orders(); track order.id) { <tr><td>{{ order.order_code }}</td><td>{{ order.customer_name }}</td><td>@for (line of order.lines; track $index) { <div>{{ line.title }} · {{ line.quantity }} 件 · {{ warehouseName(line.warehouse_id) }}</div> }</td><td>{{ order.currency }} {{ order.total_amount }}</td><td>{{ statusName(order.status) }}／{{ order.payment_status }}（{{ order.payment_provider }}）</td><td>@if (role() === 'admin' && order.status === 'pending_payment') { <button type="button" (click)="capture(order)" [disabled]="busy()">模擬 sandbox 付款</button><button type="button" (click)="cancel(order)" [disabled]="busy()">取消並釋放庫存</button> }</td></tr> }
      @empty { <tr><td colspan="6">尚無訂單。</td></tr> }
    </tbody></table></div></section>
  `,
  styles: [`
    :host { display:block; color:#163047; } section { background:white; border:1px solid #dce5eb; border-radius:12px; padding:1.25rem; margin:1rem 0; }
    .intro { display:flex; justify-content:space-between; align-items:center; gap:1rem; } h2 { margin:.2rem 0; } h3 { margin:.1rem 0 .8rem; }
    .eyebrow { color:var(--brand-accent, #39746b); font-size:.8rem; letter-spacing:.12em; } .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:.75rem; border:0; padding:0; margin:1rem 0; }
    label { display:flex; flex-direction:column; gap:.35rem; font-size:.88rem; } input,select,button { font:inherit; border:1px solid #bdcdd7; border-radius:6px; padding:.55rem .7rem; background:#fff; color:#163047; }
    button { cursor:pointer; margin:.15rem; } button:disabled { opacity:.6; cursor:wait; } .primary { background:var(--brand-primary, #17675b); color:white; } .notice { padding:.8rem; background:#fff5d8; border-radius:8px; }
    .table-scroll { overflow:auto; } table { border-collapse:collapse; width:100%; text-align:left; font-size:.85rem; } th,td { padding:.65rem; border-bottom:1px solid #e2e9ed; vertical-align:top; } .product-image { width:56px; height:56px; object-fit:cover; border-radius:6px; }
    .message { padding:.8rem; background:#e1f3ec; border-radius:8px; overflow-wrap:anywhere; } .error { color:#9c2c18; background:#fff0ec; }
    @media(max-width:600px) { .intro { align-items:flex-start; flex-direction:column; } }
  `],
})
export class EcommerceDashboard implements OnInit, OnChanges {
  readonly tenantId = input.required<string>();
  readonly role = input.required<Role>();
  readonly listings = signal<Listing[]>([]); readonly orders = signal<Order[]>([]);
  readonly products = signal<Product[]>([]); readonly warehouses = signal<Warehouse[]>([]); readonly customers = signal<Customer[]>([]);
  readonly busy = signal(false); readonly error = signal(''); readonly notice = signal('');
  productId='';warehouseId='';title='';category='';price='0.00';customerId='';listingId='';quantity=1;
  private csrf='';
  ngOnInit(): void { void this.refresh(); }
  ngOnChanges(changes: SimpleChanges): void { if (changes['tenantId'] && !changes['tenantId'].firstChange) void this.refresh(); }
  private base(): string { return `/api/v1/tenants/${this.tenantId()}`; }
  private async request<T>(url:string,method='GET',body?:unknown):Promise<T>{const r=await fetch(url,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-CSRFToken':this.csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw new Error(`${d.error?.details??'無法完成要求'} (${d.error?.request_id??r.status})`);return d as T;}
  private async run(work:()=>Promise<void>):Promise<void>{if(this.busy())return;this.busy.set(true);this.error.set('');this.notice.set('');try{await work();}catch(e){this.error.set(e instanceof Error?e.message:'連線失敗。');}finally{this.busy.set(false);}}
  async refresh():Promise<void>{await this.run(async()=>{this.csrf=(await this.request<{csrfToken:string}>('/api/v1/auth/csrf/')).csrfToken;const [li,prods,whs]=await Promise.all([
    this.request<Page<Listing>>(`${this.base()}/ecommerce/listings/`),this.request<Page<Product>>(`${this.base()}/wms/products/`),this.request<Page<Warehouse>>(`${this.base()}/wms/warehouses/`),
  ]);this.listings.set(li.results);this.products.set(prods.results);this.warehouses.set(whs.results);
    if(this.role()!=='viewer'){const [ord,cust]=await Promise.all([this.request<Page<Order>>(`${this.base()}/ecommerce/orders/`),this.request<Page<Customer>>(`${this.base()}/crm/customers/`)]);this.orders.set(ord.results);this.customers.set(cust.results);}else{this.orders.set([]);this.customers.set([]);}
  });}
  async createListing():Promise<void>{await this.run(async()=>{await this.request(`${this.base()}/ecommerce/listings/`,'POST',{product_id:this.productId,warehouse_id:this.warehouseId,title:this.title,category:this.category,currency:'TWD',price:this.price});this.title='';this.category='';this.price='0.00';await this.reload();this.notice.set('商品已上架。');});}
  async createOrder():Promise<void>{await this.run(async()=>{const result=await this.request<Order>(`${this.base()}/ecommerce/orders/`,'POST',{customer_id:this.customerId,idempotency_key:crypto.randomUUID(),lines:[{listing_id:this.listingId,quantity:this.quantity}]});this.customerId='';this.listingId='';this.quantity=1;await this.reload();this.notice.set(`已建立 ${result.order_code}，庫存已預留。`);});}
  async capture(order:Order):Promise<void>{await this.run(async()=>{await this.request(`${this.base()}/ecommerce/orders/${order.id}/capture-sandbox-payment/`,'POST',{});await this.reload();this.notice.set('Sandbox 付款成功，WMS 已扣庫並留下出庫流水。');});}
  async cancel(order:Order):Promise<void>{await this.run(async()=>{await this.request(`${this.base()}/ecommerce/orders/${order.id}/cancel/`,'POST',{});await this.reload();this.notice.set('訂單已取消並釋放預留庫存。');});}
  private async reload():Promise<void>{const [li,ord]=await Promise.all([this.request<Page<Listing>>(`${this.base()}/ecommerce/listings/`),this.request<Page<Order>>(`${this.base()}/ecommerce/orders/`)]);this.listings.set(li.results);this.orders.set(ord.results);}
  warehouseName(id:string):string{const row=this.warehouses().find(w=>w.id===id);return row?`${row.code} · ${row.name}`:'—';}
  statusName(status:string):string{return ({pending_payment:'待付款',paid:'已付款',canceled:'已取消'} as Record<string,string>)[status]??status;}
}
