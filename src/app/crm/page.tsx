import Link from "next/link";
import { CrmPanel } from "./crm-panel";

export default function CrmPage() {
  return <main><p className="eyebrow">CRM · 會員資料</p><h1>CRM 會員目錄</h1><p>依工作空間管理客戶聯絡資料。Owner 可新增、編輯與封存；Member 可搜尋及檢視。</p><nav><Link href="/workspaces">工作空間</Link><Link href="/sign-in">帳號與登入</Link></nav><CrmPanel /></main>;
}
