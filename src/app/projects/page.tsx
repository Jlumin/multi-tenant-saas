import { ProjectPanel } from "./project-panel";

export default function ProjectsPage() {
  return <main><p className="eyebrow">M2 · PROJECTS</p><h1>專案管理</h1><p>依工作空間管理專案。所有成員可新增與編輯，Owner 可刪除。</p><ProjectPanel /></main>;
}
