import { Component, input, OnChanges, OnInit, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Role = 'admin' | 'manager' | 'viewer';
interface Page<T> { results: T[]; count: number }
interface Member { id: string; username: string; role: Role; is_active: boolean }
interface Employee { id: string; code: string; display_name: string; membership_id: string | null; is_active: boolean; version: number }
interface Shift { id: string; code: string; name: string; start_time: string; end_time: string; timezone_name: string; spans_midnight: boolean; is_active: boolean }
interface Attendance { clock_in_at: string | null; clock_out_at: string | null; version: number }
interface Assignment { id: string; employee_id: string; employee_code: string; employee_name: string; shift_id: string; shift_code: string; shift_name: string; shift_start: string; shift_end: string; timezone_name: string; spans_midnight: boolean; work_date: string; attendance: Attendance | null }
interface Correction { id: string; assignment_id: string; employee_code: string; employee_name: string; field: 'clock_in' | 'clock_out'; proposed_at: string; reason: string; status: string; decision_note: string; created_at: string }
interface Event { id: string; employee_code: string; employee_name: string; work_date: string; kind: string; occurred_at: string; recorded_at: string; timezone_name: string }

@Component({
  selector: 'app-hr-dashboard', standalone: true, imports: [FormsModule],
  template: `
    <section class="intro"><div><p class="eyebrow">PHASE 4 · HR</p><h2>員工、人員排班與出勤</h2><p>員工與登入帳號分離，打卡由伺服器記時；補登需另一位租戶管理員核准。</p></div><button type="button" (click)="refresh()" [disabled]="busy()">重新整理</button></section>
    @if (error()) { <p class="message error" role="alert">{{ error() }}</p> }
    @if (notice()) { <p class="message" role="status">{{ notice() }}</p> }
    @if (role() === 'admin') {
      <section><h3>新增員工</h3><form (ngSubmit)="createEmployee()"><fieldset class="grid" [disabled]="busy()">
        <label>員工編號<input name="employeeCode" [(ngModel)]="employeeCode" maxlength="40" pattern="[A-Za-z0-9_-]+" required></label>
        <label>姓名<input name="employeeName" [(ngModel)]="employeeName" maxlength="120" required></label>
        <label>登入帳號<select name="employeeMembership" [(ngModel)]="employeeMembership"><option value="">選擇帳號（排班必填）</option>@for (member of members(); track member.id) { @if (member.is_active) { <option [value]="member.id">{{ member.username }} · {{ member.role }}</option> } }</select></label>
        <button class="primary" type="submit">新增員工</button>
      </fieldset></form></section>
      <section><h3>新增班別</h3><form (ngSubmit)="createShift()"><fieldset class="grid" [disabled]="busy()">
        <label>班別代碼<input name="shiftCode" [(ngModel)]="shiftCode" maxlength="32" pattern="[A-Za-z0-9_-]+" required></label>
        <label>名稱<input name="shiftName" [(ngModel)]="shiftName" maxlength="100" required></label>
        <label>開始時間<input name="shiftStart" type="time" [(ngModel)]="shiftStart" required></label><label>結束時間<input name="shiftEnd" type="time" [(ngModel)]="shiftEnd" required></label>
        <label>時區（IANA）<input name="shiftTimezone" [(ngModel)]="shiftTimezone" maxlength="64" required></label><button class="primary" type="submit">新增班別</button>
      </fieldset></form></section>
      <section><h3>安排班別</h3><form (ngSubmit)="createAssignment()"><fieldset class="grid" [disabled]="busy()">
        <label>員工<select name="assignmentEmployee" [(ngModel)]="assignmentEmployee" required><option value="">選擇員工</option>@for (employee of employees(); track employee.id) { @if (employee.is_active && employee.membership_id) { <option [value]="employee.id">{{ employee.code }} · {{ employee.display_name }}</option> } }</select></label>
        <label>班別<select name="assignmentShift" [(ngModel)]="assignmentShift" required><option value="">選擇班別</option>@for (shift of shifts(); track shift.id) { @if (shift.is_active) { <option [value]="shift.id">{{ shift.code }} · {{ shift.name }} ({{ shift.start_time }}–{{ shift.end_time }})</option> } }</select></label>
        <label>工作日期<input name="workDate" type="date" [(ngModel)]="workDate" required></label><button class="primary" type="submit">新增排班</button>
      </fieldset></form></section>
    }
    @if (role() !== 'viewer') { <section><h3>員工名冊</h3><div class="table-scroll"><table><thead><tr><th>編號</th><th>姓名</th><th>登入帳號</th><th>狀態</th></tr></thead><tbody>@for (employee of employees(); track employee.id) { <tr><td>{{ employee.code }}</td><td>{{ employee.display_name }}</td><td>{{ accountName(employee.membership_id) }}</td><td>{{ employee.is_active ? '啟用' : '停用' }}</td></tr> } @empty { <tr><td colspan="4">尚無員工。</td></tr> }</tbody></table></div></section> }
    @if (role() !== 'viewer') { <section><h3>班別</h3><div class="table-scroll"><table><thead><tr><th>代碼</th><th>名稱</th><th>時間</th><th>時區</th><th>狀態</th></tr></thead><tbody>@for (shift of shifts(); track shift.id) { <tr><td>{{ shift.code }}</td><td>{{ shift.name }}</td><td>{{ shift.start_time }}–{{ shift.end_time }}{{ shift.spans_midnight ? '（跨日）' : '' }}</td><td>{{ shift.timezone_name }}</td><td>{{ shift.is_active ? '啟用' : '停用' }}</td></tr> } @empty { <tr><td colspan="5">尚無班別。</td></tr> }</tbody></table></div></section> }
    <section><h3>排班與打卡</h3><p>顯示 {{ assignments().length }} / {{ assignmentCount() }} 筆；時間以班別時區呈現。補登不會覆寫原始打卡事件。</p><div class="table-scroll"><table><thead><tr><th>日期</th><th>員工</th><th>班別</th><th>打卡</th><th>操作</th></tr></thead><tbody>
      @for (assignment of assignments(); track assignment.id) { <tr><td>{{ assignment.work_date }}</td><td>{{ assignment.employee_code }} · {{ assignment.employee_name }}</td><td>{{ assignment.shift_name }} · {{ assignment.shift_start }}–{{ assignment.shift_end }}{{ assignment.spans_midnight ? '（跨日）' : '' }}<small>{{ assignment.timezone_name }}</small></td><td>上班：{{ time(assignment.attendance?.clock_in_at,assignment.timezone_name) }}<br>下班：{{ time(assignment.attendance?.clock_out_at,assignment.timezone_name) }}</td><td>@if (!assignment.attendance?.clock_in_at) { <button type="button" (click)="punch(assignment,'clock-in')" [disabled]="busy()">上班打卡</button> } @else if (!assignment.attendance?.clock_out_at) { <button type="button" (click)="punch(assignment,'clock-out')" [disabled]="busy()">下班打卡</button> }<button type="button" (click)="selectCorrection(assignment,'clock_in')">申請修正上班</button><button type="button" (click)="selectCorrection(assignment,'clock_out')">申請修正下班</button></td></tr> }
      @empty { <tr><td colspan="5">尚無可顯示的排班。</td></tr> }
    </tbody></table></div></section>
    @if (correctionAssignment) { <section><h3>申請補登／修正</h3><p>{{ correctionAssignment.employee_code }} · {{ correctionAssignment.work_date }} · {{ correctionField === 'clock_in' ? '上班' : '下班' }} · {{ correctionAssignment.timezone_name }}</p><form (ngSubmit)="requestCorrection()"><fieldset class="grid" [disabled]="busy()"><label>修正時間（瀏覽器本機時區）<input name="proposedAt" type="datetime-local" [(ngModel)]="proposedAt" required></label><label>原因<input name="reason" [(ngModel)]="reason" maxlength="500" required></label><button class="primary" type="submit">送出申請</button><button type="button" (click)="correctionAssignment=null">取消</button></fieldset></form></section> }
    <section><h3>補登申請</h3><div class="table-scroll"><table><thead><tr><th>員工</th><th>欄位</th><th>修正時間</th><th>原因</th><th>狀態</th><th>審核</th></tr></thead><tbody>@for (correction of corrections(); track correction.id) { <tr><td>{{ correction.employee_code }} · {{ correction.employee_name }}</td><td>{{ correction.field === 'clock_in' ? '上班' : '下班' }}</td><td>{{ time(correction.proposed_at, assignmentZone(correction.assignment_id)) }}</td><td>{{ correction.reason }}</td><td>{{ status(correction.status) }}</td><td>@if (role() === 'admin' && correction.status === 'pending') { <button type="button" (click)="decide(correction,'approve')" [disabled]="busy()">核准</button><button type="button" (click)="decide(correction,'reject')" [disabled]="busy()">駁回</button> } @else { {{ correction.decision_note || '—' }} }</td></tr> } @empty { <tr><td colspan="6">尚無補登申請。</td></tr> }</tbody></table></div></section>
    <section><h3>出勤異動紀錄</h3><div class="table-scroll"><table><thead><tr><th>時間</th><th>員工</th><th>工作日</th><th>事件</th><th>伺服器記錄時間</th></tr></thead><tbody>@for (event of events(); track event.id) { <tr><td>{{ time(event.occurred_at,event.timezone_name) }}</td><td>{{ event.employee_code }} · {{ event.employee_name }}</td><td>{{ event.work_date }}</td><td>{{ eventName(event.kind) }}</td><td>{{ time(event.recorded_at,event.timezone_name) }}</td></tr> } @empty { <tr><td colspan="5">尚無打卡紀錄。</td></tr> }</tbody></table></div></section>
  `,
  styles: [`
    :host{display:block;color:#163047}section{background:white;border:1px solid #dce5eb;border-radius:12px;padding:1.25rem;margin:1rem 0}.intro{display:flex;justify-content:space-between;align-items:center;gap:1rem}.eyebrow{color:var(--brand-accent, #39746b);font-size:.8rem;letter-spacing:.12em}h2{margin:.2rem 0}h3{margin:.1rem 0 .8rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;border:0;padding:0;margin:1rem 0}label{display:flex;flex-direction:column;gap:.35rem;font-size:.88rem}input,select,button{font:inherit;border:1px solid #bdcdd7;border-radius:6px;padding:.55rem .7rem;background:#fff;color:#163047}button{cursor:pointer;margin:.15rem}button:disabled{opacity:.6;cursor:wait}.primary{background:var(--brand-primary, #17675b);color:white}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;text-align:left;font-size:.85rem}th,td{padding:.65rem;border-bottom:1px solid #e2e9ed;vertical-align:top}small{display:block;color:#566a7b}.message{padding:.8rem;background:#e1f3ec;border-radius:8px;overflow-wrap:anywhere}.error{color:#9c2c18;background:#fff0ec}@media(max-width:600px){.intro{align-items:flex-start;flex-direction:column}}
  `],
})
export class HrDashboard implements OnInit, OnChanges {
  readonly tenantId = input.required<string>(); readonly role = input.required<Role>();
  readonly employees = signal<Employee[]>([]); readonly shifts = signal<Shift[]>([]); readonly members = signal<Member[]>([]);
  readonly assignments = signal<Assignment[]>([]); readonly assignmentCount = signal(0); readonly corrections = signal<Correction[]>([]); readonly events = signal<Event[]>([]);
  readonly busy = signal(false); readonly error = signal(''); readonly notice = signal('');
  employeeCode='';employeeName='';employeeMembership='';shiftCode='';shiftName='';shiftStart='09:00';shiftEnd='18:00';shiftTimezone='Asia/Taipei';assignmentEmployee='';assignmentShift='';workDate=new Date().toLocaleDateString('en-CA');
  correctionAssignment: Assignment|null=null;correctionField:'clock_in'|'clock_out'='clock_in';proposedAt='';reason='';private csrf='';
  ngOnInit():void{void this.refresh()} ngOnChanges(c:SimpleChanges):void{if(c['tenantId']&&!c['tenantId'].firstChange)void this.refresh()}
  private base():string{return `/api/v1/tenants/${this.tenantId()}/hr`}
  private async request<T>(url:string,method='GET',body?:unknown):Promise<T>{const r=await fetch(url,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-CSRFToken':this.csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw new Error(`${d.error?.details??'無法完成要求'} (${d.error?.request_id??r.status})`);return d as T}
  private async run(work:()=>Promise<void>):Promise<void>{if(this.busy())return;this.busy.set(true);this.error.set('');this.notice.set('');try{await work()}catch(e){this.error.set(e instanceof Error?e.message:'連線失敗。')}finally{this.busy.set(false)}}
  async refresh():Promise<void>{await this.run(()=>this.loadData())}
  private async loadData():Promise<void>{this.csrf=(await this.request<{csrfToken:string}>('/api/v1/auth/csrf/')).csrfToken;const base=this.base();const [as,cs,es]=await Promise.all([this.request<Page<Assignment>>(`${base}/assignments/`),this.request<Page<Correction>>(`${base}/corrections/`),this.request<Page<Event>>(`${base}/events/`)]);this.assignments.set(as.results);this.assignmentCount.set(as.count);this.corrections.set(cs.results);this.events.set(es.results);if(this.role()!=='viewer'){const [em,sh,mem]=await Promise.all([this.request<Page<Employee>>(`${base}/employees/`),this.request<Page<Shift>>(`${base}/shifts/`),this.role()==='admin'?this.request<Page<Member>>(`/api/v1/tenants/${this.tenantId()}/members/?limit=100`):Promise.resolve({results:[],count:0})]);this.employees.set(em.results);this.shifts.set(sh.results);this.members.set(mem.results)}else{this.employees.set([]);this.shifts.set([]);this.members.set([])}}
  private async reload():Promise<void>{await this.loadData()}
  async createEmployee():Promise<void>{await this.run(async()=>{await this.request(`${this.base()}/employees/`,'POST',{code:this.employeeCode,display_name:this.employeeName,membership_id:this.employeeMembership||null});this.employeeCode='';this.employeeName='';this.employeeMembership='';await this.reload();this.notice.set('員工已建立。')})}
  async createShift():Promise<void>{await this.run(async()=>{await this.request(`${this.base()}/shifts/`,'POST',{code:this.shiftCode,name:this.shiftName,start_time:this.shiftStart,end_time:this.shiftEnd,timezone_name:this.shiftTimezone});this.shiftCode='';this.shiftName='';await this.reload();this.notice.set('班別已建立。')})}
  async createAssignment():Promise<void>{await this.run(async()=>{await this.request(`${this.base()}/assignments/`,'POST',{employee_id:this.assignmentEmployee,shift_id:this.assignmentShift,work_date:this.workDate});this.assignmentEmployee='';this.assignmentShift='';await this.reload();this.notice.set('排班已建立。')})}
  async punch(a:Assignment,action:'clock-in'|'clock-out'):Promise<void>{await this.run(async()=>{await this.request(`${this.base()}/assignments/${a.id}/${action}/`,'POST',{idempotency_key:crypto.randomUUID()});await this.reload();this.notice.set(action==='clock-in'?'上班打卡已記錄。':'下班打卡已記錄。')})}
  selectCorrection(a:Assignment,field:'clock_in'|'clock_out'):void{this.correctionAssignment=a;this.correctionField=field;const now=new Date();this.proposedAt=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);this.reason=''}
  async requestCorrection():Promise<void>{const a=this.correctionAssignment;if(!a)return;await this.run(async()=>{await this.request(`${this.base()}/corrections/`,'POST',{assignment_id:a.id,field:this.correctionField,proposed_at:new Date(this.proposedAt).toISOString(),reason:this.reason});this.correctionAssignment=null;await this.reload();this.notice.set('補登申請已送出，待管理員審核。')})}
  async decide(c:Correction,action:'approve'|'reject'):Promise<void>{await this.run(async()=>{await this.request(`${this.base()}/corrections/${c.id}/${action}/`,'POST',{});await this.reload();this.notice.set(action==='approve'?'補登已核准並追加異動紀錄。':'補登申請已駁回。')})}
  accountName(id:string|null):string{return this.members().find(m=>m.id===id)?.username??(id?'已連結帳號':'未連結')}
  time(value:string|null|undefined,zone='Asia/Taipei'):string{return value?new Intl.DateTimeFormat('zh-TW',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'—'}
  assignmentZone(id:string):string{return this.assignments().find(a=>a.id===id)?.timezone_name??'Asia/Taipei'}
  status(s:string):string{return({pending:'待審核',approved:'已核准',rejected:'已駁回'} as Record<string,string>)[s]??s}
  eventName(s:string):string{return({clock_in:'上班打卡',clock_out:'下班打卡',correction_in:'補登上班',correction_out:'補登下班'} as Record<string,string>)[s]??s}
}
