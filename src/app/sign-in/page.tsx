import { AuthPanel } from "../auth-panel";
import Link from "next/link";

export default function SignIn() {
  return <main><p className="eyebrow">MULTI-TENANT SAAS · AUTH</p><h1>帳號與身分</h1><AuthPanel /><Link href="/">返回首頁</Link></main>;
}
