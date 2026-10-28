import Link from "next/link";
import { HrPanel } from "./hr-panel";

export default function HrPage() {
  return <main><p className="eyebrow">HR · 出勤管理</p><h1>員工打卡</h1><p>登入的工作空間成員可替本人打卡；Owner 可管理員工名冊並查閱出勤紀錄。</p><nav><Link href="/workspaces">工作空間與成員</Link><Link href="/projects">專案</Link></nav><HrPanel /></main>;
}
