import { Component, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Role = 'admin' | 'manager' | 'viewer';
interface Page<T> { results: T[]; count: number }
interface Product { id: string; code: string; name: string; base_unit: string; is_active: boolean; version: number; image_url:string|null }
interface PackageUnit { id: string; product_id: string; code: string; name: string; base_quantity: number; is_base: boolean; is_active: boolean }
interface Warehouse { id: string; code: string; name: string; is_active: boolean; version: number }
interface Location { id: string; warehouse_id: string; code: string; name: string; is_default: boolean; is_active: boolean; version: number }
interface Balance { product_code: string; product_name: string; warehouse_code: string; location_code: string; quantity: number }
interface DocumentLine { id: string; product_code: string; unit_code: string; location_code: string; quantity: number; conversion_snapshot: number; base_quantity: number }
interface DraftLine { product_id:string; package_unit_id:string; location_id:string; quantity:number; product_code:string; unit_code:string; location_code:string; base_quantity:number }
interface Document { id: string; kind: 'receipt' | 'issue'; status: 'draft' | 'posted' | 'canceled'; document_code: string; warehouse_code: string; note: string; created_at: string; lines: DocumentLine[] }

@Component({
  selector: 'app-wms-dashboard',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="wms-intro"><div><p class="eyebrow">PHASE 2 · WMS</p><h2>倉儲與庫存</h2><p>整數數量、包裝換算、多倉與儲位；所有過帳由租戶管理員執行。</p></div>
      <button type="button" (click)="refresh()" [disabled]="busy()">重新整理</button></section>
    @if (error()) { <p class="message error" role="alert">{{ error() }}</p> }
    @if (notice()) { <p class="message" role="status">{{ notice() }}</p> }
    @if (busy()) { <p role="status">處理中…</p> }

    <div class="wms-grid">
      <section><h3>商品</h3><p>共 {{ products().length }} / {{ productCount() }} 筆</p>
        @if (role() === 'admin') { <form (ngSubmit)="createProduct()"><fieldset [disabled]="busy()" class="form-grid">
          <label>商品代碼<input name="productCode" [(ngModel)]="productCode" maxlength="40" required></label>
          <label>商品名稱<input name="productName" [(ngModel)]="productName" maxlength="120" required></label>
          <label>基本單位<input name="baseUnit" [(ngModel)]="baseUnit" maxlength="20" required></label>
          <button class="primary" type="submit">新增商品</button>
        </fieldset></form> }
        <div class="table-scroll"><table><thead><tr><th>圖片</th><th>代碼</th><th>名稱</th><th>基本單位</th><th>狀態／操作</th></tr></thead><tbody>
          @for (item of products(); track item.id) { <tr><td>@if (item.image_url) { <img class="product-image" [src]="item.image_url" [alt]="item.name"> } @else { <span>尚無圖片</span> } @if (role() === 'admin') { <input type="file" accept="image/jpeg,image/png,image/webp" [attr.aria-label]="'上傳 ' + item.name + ' 商品圖片'" (change)="uploadProductImage(item,$event)" [disabled]="busy()"> }</td><td>{{ item.code }}</td><td>{{ item.name }}</td><td>{{ item.base_unit }}</td><td>{{ item.is_active ? '啟用' : '停用' }} @if (role() === 'admin') { <button type="button" (click)="renameProduct(item)" [disabled]="busy()">改名稱</button> <button type="button" (click)="toggleProduct(item)" [disabled]="busy()">{{ item.is_active ? '停用' : '啟用' }}</button> @if(item.image_url){ <button type="button" (click)="removeProductImage(item)" [disabled]="busy()">移除圖片</button> } }</td></tr> }
        </tbody></table></div>
        @if (role() === 'admin' && selectedProductId()) { <p>目前所選商品：{{ products().find(p => p.id === selectedProductId())?.code }}</p><form (ngSubmit)="createUnit()"><fieldset [disabled]="busy()" class="form-grid">
          <label>包裝代碼<input name="unitCode" [(ngModel)]="unitCode" maxlength="24" required></label>
          <label>包裝名稱<input name="unitName" [(ngModel)]="unitName" maxlength="60" required></label>
          <label>每包基本單位數<input name="unitQuantity" type="number" min="1" max="1000000" step="1" [(ngModel)]="unitQuantity" required></label>
          <button type="submit">新增所選商品包裝</button>
        </fieldset></form>
          @for (unit of units(); track unit.id) { <p>{{ unit.code }} · {{ unit.name }} · {{ unit.base_quantity }} {{ baseUnitForSelected() }} · {{ unit.is_active ? '啟用' : '停用' }} @if (!unit.is_base) { <button type="button" (click)="toggleUnit(unit)" [disabled]="busy()">{{ unit.is_active ? '停用' : '啟用' }}</button> }</p> }
        }
      </section>

      <section><h3>倉庫與儲位</h3><p>每個新倉庫自動建立「未分配儲位」。</p>
        @if (role() === 'admin') { <form (ngSubmit)="createWarehouse()"><fieldset [disabled]="busy()" class="form-grid">
          <label>倉庫代碼<input name="warehouseCode" [(ngModel)]="warehouseCode" maxlength="40" required></label>
          <label>倉庫名稱<input name="warehouseName" [(ngModel)]="warehouseName" maxlength="120" required></label>
          <button class="primary" type="submit">新增倉庫</button>
        </fieldset></form> }
        @for (warehouse of warehouses(); track warehouse.id) { <article><strong>{{ warehouse.code }} · {{ warehouse.name }}</strong> · {{ warehouse.is_active ? '啟用' : '停用' }} @if (role() === 'admin') { <button type="button" (click)="renameWarehouse(warehouse)" [disabled]="busy()">改名稱</button> <button type="button" (click)="toggleWarehouse(warehouse)" [disabled]="busy()">{{ warehouse.is_active ? '停用' : '啟用' }}</button> }
          @if (role() === 'admin') { <form class="form-grid compact" (ngSubmit)="createLocation(warehouse)">
            <label>儲位代碼<input name="locCode{{ warehouse.id }}" [(ngModel)]="locationCodes[warehouse.id]" maxlength="40" required></label>
            <label>儲位名稱<input name="locName{{ warehouse.id }}" [(ngModel)]="locationNames[warehouse.id]" maxlength="120" required></label>
            <button type="submit" [disabled]="busy()">新增儲位</button>
          </form> }
          <p>@for (location of locationsByWarehouse()[warehouse.id] || []; track location.id) { <span class="chip">{{ location.code }} · {{ location.name }} · {{ location.is_active ? '啟用' : '停用' }} @if (role() === 'admin') { <button type="button" (click)="renameLocation(location)" [disabled]="busy()">改名稱</button> @if (!location.is_default) { <button type="button" (click)="toggleLocation(location)" [disabled]="busy()">{{ location.is_active ? '停用' : '啟用' }}</button> } }</span> }</p>
        </article> } @empty { <p>尚無倉庫。</p> }
      </section>
    </div>

    <section><h3>入庫／出庫草稿</h3><p>管理員可過帳；出庫若不足會整筆拒絕，庫存不會變成負數。期初庫存尚未開放。</p>
      @if (role() !== 'viewer') { <form (ngSubmit)="createDocument()"><fieldset [disabled]="busy()" class="form-grid">
        <label>單據類型<select name="kind" [(ngModel)]="documentKind"><option value="receipt">一般入庫</option><option value="issue">一般出庫</option></select></label>
        <label>倉庫<select name="docWarehouse" [(ngModel)]="documentWarehouseId" (ngModelChange)="selectWarehouse()" required><option value="">選擇倉庫</option>@for (w of warehouses(); track w.id) { @if (w.is_active) { <option [value]="w.id">{{ w.code }} · {{ w.name }}</option> } }</select></label>
        <label>商品<select name="docProduct" [(ngModel)]="documentProductId" (ngModelChange)="loadUnits()" required><option value="">選擇商品</option>@for (p of products(); track p.id) { @if (p.is_active) { <option [value]="p.id">{{ p.code }} · {{ p.name }}</option> } }</select></label>
        <label>包裝<select name="docUnit" [(ngModel)]="documentUnitId" required><option value="">選擇單位</option>@for (u of units(); track u.id) { @if (u.is_active) { <option [value]="u.id">{{ u.code }} · {{ u.name }}（{{ u.base_quantity }} {{ baseUnitForSelected() }}）</option> } }</select></label>
        <label>儲位<select name="docLocation" [(ngModel)]="documentLocationId" required><option value="">選擇儲位</option>@for (l of locationsByWarehouse()[documentWarehouseId] || []; track l.id) { @if (l.is_active) { <option [value]="l.id">{{ l.code }} · {{ l.name }}</option> } }</select></label>
        <label>包裝數量（整數）<input name="docQuantity" type="number" min="1" step="1" [(ngModel)]="documentQuantity" required></label>
        <label>單號<input name="docCode" [(ngModel)]="documentCode" maxlength="40" required></label>
        <label>備註<input name="docNote" [(ngModel)]="documentNote" maxlength="500"></label>
        <button type="button" (click)="addDraftLine()" [disabled]="busy() || !documentProductId || !documentUnitId || !documentLocationId">加入單據明細</button>
        <button class="primary" type="submit" [disabled]="busy() || draftLines().length === 0">建立草稿</button>
      </fieldset></form>
        <div class="draft-lines">@for (line of draftLines(); track $index) { <p>{{ line.product_code }} · {{ line.quantity }} {{ line.unit_code }} = {{ line.base_quantity }} · {{ line.location_code }} <button type="button" (click)="removeDraftLine($index)" [disabled]="busy()">移除</button></p> } @empty { <p>請先加入一筆以上明細。</p> }</div>
      }
      <div class="table-scroll"><table><thead><tr><th>單號</th><th>類型</th><th>倉庫</th><th>明細</th><th>狀態</th><th>操作</th></tr></thead><tbody>
        @for (doc of documents(); track doc.id) { <tr><td>{{ doc.document_code }}</td><td>{{ doc.kind === 'receipt' ? '入庫' : '出庫' }}</td><td>{{ doc.warehouse_code }}</td>
          <td>@for (line of doc.lines; track line.id) { <div>{{ line.product_code }} · {{ line.quantity }} {{ line.unit_code }} = {{ line.base_quantity }} · {{ line.location_code }}</div> }</td>
          <td>{{ statusName(doc.status) }}</td><td>@if (doc.status === 'draft' && role() === 'admin') { <button type="button" (click)="postDocument(doc)" [disabled]="busy()">管理員過帳</button> } @else if (doc.status === 'draft' && role() !== 'viewer') { <button type="button" (click)="cancelDocument(doc)" [disabled]="busy()">取消草稿</button> }</td>
        </tr> } @empty { <tr><td colspan="6">尚無入庫／出庫單據。</td></tr> }
      </tbody></table></div>
    </section>

    <div class="wms-grid"><section><h3>目前庫存</h3><div class="table-scroll"><table><thead><tr><th>商品</th><th>倉庫</th><th>儲位</th><th>基本單位數量</th></tr></thead><tbody>
      @for (row of balances(); track row.product_code + row.warehouse_code + row.location_code) { <tr><td>{{ row.product_code }} · {{ row.product_name }}</td><td>{{ row.warehouse_code }}</td><td>{{ row.location_code }}</td><td>{{ row.quantity }}</td></tr> }
      @empty { <tr><td colspan="4">目前沒有正庫存。</td></tr> }
    </tbody></table></div></section>
    <section><h3>最近庫存異動</h3><div class="table-scroll"><table><thead><tr><th>單號</th><th>商品</th><th>倉庫／儲位</th><th>基本單位異動</th><th>時間</th></tr></thead><tbody>
      @for (row of movements(); track row.id) { <tr><td>{{ row.document_code }}</td><td>{{ row.product_code }}</td><td>{{ row.warehouse_code }} / {{ row.location_code }}</td><td>{{ row.quantity_delta > 0 ? '+' : '' }}{{ row.quantity_delta }}</td><td>{{ row.created_at }}</td></tr> }
      @empty { <tr><td colspan="5">尚無異動。</td></tr> }
    </tbody></table></div></section></div>
  `,
  styles: [`
    :host { display:block; color:#163047; }
    section { background:white; border:1px solid #dce5eb; border-radius:12px; padding:1.25rem; margin:1rem 0; }
    h2 { margin:.2rem 0; } h3 { margin:.1rem 0 .5rem; }
    .wms-intro { display:flex; justify-content:space-between; align-items:center; gap:1rem; }
    .wms-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:1rem; }
    .wms-grid section { min-width:0; }
    .form-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:.75rem; border:0; padding:0; margin:1rem 0; }
    .form-grid label { display:flex; flex-direction:column; gap:.35rem; font-size:.88rem; }
    input,select,button { font:inherit; border:1px solid #bdcdd7; border-radius:6px; padding:.55rem .7rem; background:#fff; color:#163047; }
    .product-image { width:56px; height:56px; object-fit:cover; border-radius:6px; display:block; margin:.25rem 0; }
    button { cursor:pointer; } button:disabled { opacity:.6; cursor:wait; } .primary { background:var(--brand-primary, #17675b); color:white; }
    article { border-top:1px solid #e2e9ed; padding:.75rem 0; } .compact { margin:.5rem 0; }
    .chip { display:inline-block; padding:.2rem .5rem; margin:.15rem; border-radius:20px; background:#e1f3ec; font-size:.82rem; }
    .table-scroll { overflow:auto; } table { border-collapse:collapse; width:100%; text-align:left; font-size:.85rem; } th,td { padding:.65rem; border-bottom:1px solid #e2e9ed; vertical-align:top; }
    .message { padding:.8rem; background:#e1f3ec; border-radius:8px; overflow-wrap:anywhere; } .error { color:#9c2c18; background:#fff0ec; }
    .eyebrow { color:var(--brand-accent, #39746b); font-size:.8rem; letter-spacing:.12em; }
    @media(max-width:600px) { .wms-intro { align-items:flex-start; flex-direction:column; } .wms-grid { grid-template-columns:1fr; } }
  `],
})
export class WmsDashboard implements OnInit {
  readonly tenantId = input.required<string>();
  readonly role = input.required<Role>();
  readonly products = signal<Product[]>([]);
  readonly productCount = signal(0);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly locationsByWarehouse = signal<Record<string, Location[]>>({});
  readonly balances = signal<Balance[]>([]);
  readonly movements = signal<Array<{id:string;document_code:string;product_code:string;warehouse_code:string;location_code:string;quantity_delta:number;created_at:string}>>([]);
  readonly documents = signal<Document[]>([]);
  readonly draftLines = signal<DraftLine[]>([]);
  readonly units = signal<PackageUnit[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly selectedProductId = signal('');
  readonly baseUnitForSelected = signal('PCS');
  productCode = ''; productName = ''; baseUnit = 'PCS';
  warehouseCode = ''; warehouseName = '';
  locationCodes: Record<string, string> = {}; locationNames: Record<string, string> = {};
  unitCode = ''; unitName = ''; unitQuantity = 1;
  documentKind: 'receipt' | 'issue' = 'receipt'; documentWarehouseId = ''; documentProductId = ''; documentUnitId = ''; documentLocationId = '';
  documentQuantity = 1; documentCode = ''; documentNote = '';
  private csrfToken = '';

  ngOnInit(): void { void this.run(async () => { this.csrfToken = (await this.request<{csrfToken:string}>('/api/v1/auth/csrf/')).csrfToken; await this.load(); }); }
  private base(): string { return `/api/v1/tenants/${this.tenantId()}/wms`; }
  private async request<T>(url:string, method='GET', body?:unknown):Promise<T> {
    const response = await fetch(url, { method, credentials:'same-origin', headers:{'Content-Type':'application/json', ...(method==='GET'?{}:{'X-CSRFToken':this.csrfToken})}, ...(body===undefined?{}:{body:JSON.stringify(body)}) });
    const payload = await response.json();
    if (!response.ok) { const details=payload.error?.details ?? '無法完成要求'; throw new Error(`${typeof details==='string'?details:JSON.stringify(details)} (${payload.error?.request_id ?? response.status})`); }
    return payload as T;
  }
  private async requestForm<T>(url:string, form:FormData):Promise<T> {
    const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'X-CSRFToken':this.csrfToken},body:form});const payload=await response.json();
    if(!response.ok){const details=payload.error?.details??'無法完成要求';throw new Error(`${typeof details==='string'?details:JSON.stringify(details)} (${payload.error?.request_id??response.status})`);}return payload as T;
  }
  private async run(work:()=>Promise<void>):Promise<void> {
    if (this.busy()) return; this.busy.set(true); this.error.set(''); this.notice.set('');
    try { await work(); } catch (error) { this.error.set(error instanceof Error?error.message:'連線失敗，請稍後重試。'); }
    finally { this.busy.set(false); }
  }
  async refresh():Promise<void> { await this.run(()=>this.load()); }
  private async load():Promise<void> {
    const base=this.base();
    const [products,warehouses,balances,movements,documents]=await Promise.all([
      this.request<Page<Product>>(`${base}/products/?limit=100`),this.request<Page<Warehouse>>(`${base}/warehouses/?limit=100`),
      this.request<Page<Balance>>(`${base}/balances/?limit=100`),this.request<Page<{id:string;document_code:string;product_code:string;warehouse_code:string;location_code:string;quantity_delta:number;created_at:string}>>(`${base}/movements/?limit=50`),
      this.request<Page<Document>>(`${base}/documents/?limit=50`),
    ]);
    this.products.set(products.results); this.productCount.set(products.count); this.warehouses.set(warehouses.results);
    this.balances.set(balances.results); this.movements.set(movements.results); this.documents.set(documents.results);
    const results=await Promise.all(warehouses.results.map(async warehouse=>{
      const page=await this.request<Page<Location>>(`${base}/warehouses/${warehouse.id}/locations/?limit=100`); return [warehouse.id,page.results] as const;
    })); this.locationsByWarehouse.set(Object.fromEntries(results));
    if (this.documentWarehouseId && !warehouses.results.some(w=>w.id===this.documentWarehouseId)) this.documentWarehouseId='';
    if (this.documentProductId) await this.loadUnits();
    this.baseUnitForSelected.set(this.products().find(p=>p.id===this.documentProductId)?.base_unit ?? 'PCS');
  }
  async createProduct():Promise<void> { await this.run(async()=>{ await this.request(`${this.base()}/products/`,'POST',{code:this.productCode,name:this.productName,base_unit:this.baseUnit}); this.productCode='';this.productName='';await this.load();this.notice.set('商品已建立，並自動建立基本單位。'); }); }
  async uploadProductImage(item:Product,event:Event):Promise<void>{const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;await this.run(async()=>{const form=new FormData();form.set('image',file);await this.requestForm(`${this.base()}/products/${item.id}/image/`,form);await this.load();this.notice.set('商品圖片已更新。');});(event.target as HTMLInputElement).value='';}
  async removeProductImage(item:Product):Promise<void>{await this.run(async()=>{await this.request(`${this.base()}/products/${item.id}/image/`,'DELETE');await this.load();this.notice.set('商品圖片已移除。');});}
  async renameProduct(item:Product):Promise<void> { const name=prompt('商品名稱',item.name)?.trim();if(!name||name===item.name)return;await this.run(async()=>{await this.request(`${this.base()}/products/${item.id}/`,'PATCH',{version:item.version,name});await this.load();this.notice.set('商品名稱已更新。');}); }
  async toggleProduct(item:Product):Promise<void> { await this.run(async()=>{await this.request(`${this.base()}/products/${item.id}/`,'PATCH',{version:item.version,is_active:!item.is_active});await this.load();this.notice.set('商品狀態已更新。');}); }
  async createWarehouse():Promise<void> { await this.run(async()=>{ await this.request(`${this.base()}/warehouses/`,'POST',{code:this.warehouseCode,name:this.warehouseName});this.warehouseCode='';this.warehouseName='';await this.load();this.notice.set('倉庫與未分配儲位已建立。'); }); }
  async toggleWarehouse(warehouse:Warehouse):Promise<void> { await this.run(async()=>{await this.request(`${this.base()}/warehouses/${warehouse.id}/`,'PATCH',{version:warehouse.version,is_active:!warehouse.is_active});await this.load();this.notice.set('倉庫狀態已更新。');}); }
  async renameWarehouse(warehouse:Warehouse):Promise<void> { const name=prompt('倉庫名稱',warehouse.name)?.trim();if(!name||name===warehouse.name)return;await this.run(async()=>{await this.request(`${this.base()}/warehouses/${warehouse.id}/`,'PATCH',{version:warehouse.version,name});await this.load();this.notice.set('倉庫名稱已更新。');}); }
  async createLocation(warehouse:Warehouse):Promise<void> { await this.run(async()=>{await this.request(`${this.base()}/warehouses/${warehouse.id}/locations/`,'POST',{code:this.locationCodes[warehouse.id],name:this.locationNames[warehouse.id]});this.locationCodes[warehouse.id]='';this.locationNames[warehouse.id]='';await this.load();this.notice.set('儲位已建立。');}); }
  async toggleLocation(location:Location):Promise<void> { await this.run(async()=>{await this.request(`${this.base()}/locations/${location.id}/`,'PATCH',{version:location.version,is_active:!location.is_active});await this.load();this.notice.set('儲位狀態已更新。');}); }
  async renameLocation(location:Location):Promise<void> { const name=prompt('儲位名稱',location.name)?.trim();if(!name||name===location.name)return;await this.run(async()=>{await this.request(`${this.base()}/locations/${location.id}/`,'PATCH',{version:location.version,name});await this.load();this.notice.set('儲位名稱已更新。');}); }
  async createUnit():Promise<void> { const id=this.selectedProductId();if(!id)return;await this.run(async()=>{await this.request(`${this.base()}/products/${id}/units/`,'POST',{code:this.unitCode,name:this.unitName,base_quantity:this.unitQuantity});this.unitCode='';this.unitName='';this.unitQuantity=1;await this.loadUnits();this.notice.set('包裝單位已建立。');}); }
  async toggleUnit(unit:PackageUnit):Promise<void> { const id=this.selectedProductId();if(!id)return;await this.run(async()=>{await this.request(`${this.base()}/products/${id}/units/${unit.id}/`,'PATCH',{is_active:!unit.is_active});await this.loadUnits();this.notice.set('包裝單位狀態已更新。');}); }
  async loadUnits():Promise<void> { const id=this.documentProductId || this.selectedProductId();this.selectedProductId.set(id);if(!id){this.units.set([]);return;}const page=await this.request<Page<PackageUnit>>(`${this.base()}/products/${id}/units/?limit=100`);this.units.set(page.results);this.baseUnitForSelected.set(this.products().find(p=>p.id===id)?.base_unit ?? 'PCS'); }
  selectWarehouse():void { const locations=this.locationsByWarehouse()[this.documentWarehouseId]??[];this.documentLocationId=locations.find(l=>l.is_default)?.id??locations[0]?.id??'';this.draftLines.set([]); }
  addDraftLine():void { const product=this.products().find(p=>p.id===this.documentProductId);const unit=this.units().find(u=>u.id===this.documentUnitId);const location=(this.locationsByWarehouse()[this.documentWarehouseId]||[]).find(l=>l.id===this.documentLocationId);if(!product||!unit||!location||!Number.isSafeInteger(this.documentQuantity)||this.documentQuantity<1)return;this.draftLines.update(lines=>[...lines,{product_id:product.id,package_unit_id:unit.id,location_id:location.id,quantity:this.documentQuantity,product_code:product.code,unit_code:unit.code,location_code:location.code,base_quantity:this.documentQuantity*unit.base_quantity}]); }
  removeDraftLine(index:number):void { this.draftLines.update(lines=>lines.filter((_,i)=>i!==index)); }
  async createDocument():Promise<void> { await this.run(async()=>{if(!this.draftLines().length)throw new Error('請先加入單據明細。');const key=crypto.randomUUID();await this.request(`${this.base()}/documents/`,'POST',{kind:this.documentKind,warehouse_id:this.documentWarehouseId,document_code:this.documentCode,idempotency_key:key,note:this.documentNote,lines:this.draftLines().map(({product_id,package_unit_id,location_id,quantity})=>({product_id,package_unit_id,location_id,quantity}))});this.documentCode='';this.documentNote='';this.documentQuantity=1;this.draftLines.set([]);await this.load();this.notice.set('庫存單據草稿已建立。');}); }
  async postDocument(doc:Document):Promise<void> { if(!confirm(`確認過帳 ${doc.document_code}？過帳後不可編輯。`))return;await this.run(async()=>{await this.request(`${this.base()}/documents/${doc.id}/post/`,'POST',{});await this.load();this.notice.set('單據已過帳，庫存與異動紀錄已更新。');}); }
  async cancelDocument(doc:Document):Promise<void> { await this.run(async()=>{await this.request(`${this.base()}/documents/${doc.id}/cancel/`,'POST',{});await this.load();this.notice.set('草稿已取消。');}); }
  statusName(status:Document['status']):string { return ({draft:'草稿',posted:'已過帳',canceled:'已取消'} as const)[status]; }
}

