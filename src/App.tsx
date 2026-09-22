import { useState } from 'react';
import { Alert, Button, Drawer, Spin } from 'antd';
import { Bell, BriefcaseBusiness, ChevronRight, Download, MessageSquare, Send, Settings2, UsersRound } from 'lucide-react';
import { useDesktop, formatTime } from './bridge';
import { Accounts } from './Accounts';
import { Takeover } from './Takeover';
import { Tasks } from './Tasks';
import { Knowledge } from './Knowledge';
import { Settings } from './Settings';
import { Rules, Templates } from './Editors';
import { EmptyState, PrimitiveShowcase } from './primitives';
import './workspace.css';

type Page = 'accounts' | 'takeover' | 'tasks';
const navigation = [ { id: 'accounts', label: '账号管理', icon: UsersRound }, { id: 'takeover', label: '智能接管', icon: MessageSquare }, { id: 'tasks', label: '自动打招呼', icon: Send } ] as const;
export function App() {
  const { state, run, busy, notice, clearNotice, native } = useDesktop();
  const [page, setPage] = useState<Page>('accounts');
  const [knowledgeOpen,setKnowledgeOpen]=useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [rulesJob, setRulesJob] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('primitives')) return <PrimitiveShowcase />;
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><BriefcaseBusiness size={22} /></span><div><strong>招聘工作台</strong><small>RECRUITMENT</small></div></div><div className="nav-category">智联招聘助手</div><nav className="main-nav" aria-label="主导航">{navigation.map(item => <button key={item.id} className={`nav-button ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><item.icon size={18} /><span>{item.label}</span>{page === item.id && <ChevronRight size={14} />}</button>)}</nav><div className="sidebar-bottom"><button className="nav-button" aria-label="公司与岗位知识库" onClick={()=>setKnowledgeOpen(true)}><BriefcaseBusiness size={18}/><span>公司与岗位知识库</span></button><button className="nav-button" aria-label="任务记录" onClick={() => setActivityOpen(true)}><Bell size={18} /><span>任务记录</span></button><button className="nav-button" aria-label="应用设置" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /><span>应用设置</span></button><div className="local-info"><span className="local-dot" />本地工作台 <small>V1.0</small></div></div></aside><div className="workspace"><header className="topbar"><div className="breadcrumb">招聘工作台 <ChevronRight size={14} /><span>{navigation.find(item => item.id === page)?.label}</span></div><div className="cluster"><span className="platform-pill">智联招聘</span><Button type="text" aria-label="查看任务记录" icon={<Bell size={18} />} onClick={() => setActivityOpen(true)} /></div></header><div className="workspace-body">{!native && <div className="bridge-banner"><Alert type="info" showIcon message="网页预览 · 请在桌面应用中连接账号" description="预览不会连接平台或保存资料。" /></div>}{notice && <div className="bridge-banner" role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite"><Alert closable onClose={clearNotice} showIcon type={notice.kind} message={notice.text} /></div>}{busy && <div className="busy-indicator" role="status"><Spin size="small" /><span>正在处理…</span></div>}{page === 'accounts' && <Accounts state={state} run={run} busy={busy} openSettings={() => setSettingsOpen(true)} />}{page === 'takeover' && <Takeover state={state} run={run} busy={busy} openRules={setRulesJob} />}{page === 'tasks' && <Tasks state={state} run={run} busy={busy} openTemplates={() => setTemplatesOpen(true)} />}</div></div>{knowledgeOpen && <Knowledge documents={state.knowledge} jobs={state.jobs} accounts={state.accounts} busy={busy} save={value=>run({type:'saveKnowledge',value})} remove={id=>run({type:'deleteKnowledge',id})} close={()=>setKnowledgeOpen(false)}/>} {settingsOpen && <Settings state={state} run={run} busy={busy} close={() => setSettingsOpen(false)} />}{templatesOpen && <Templates state={state} run={run} busy={busy} close={() => setTemplatesOpen(false)} />}{rulesJob !== null && <Rules state={state} run={run} busy={busy} initialJob={rulesJob} close={() => setRulesJob(null)} />}<Drawer title="任务记录" open={activityOpen} onClose={() => setActivityOpen(false)} width={480} extra={<Button icon={<Download size={15} />} disabled={busy} onClick={() => void run({ type: 'exportData' })}>导出数据</Button>}>{state.events.length === 0 ? <EmptyState title="暂无任务记录" description="账号连接、资料变更与任务处理记录会显示在这里。" /> : <ol className="event-list">{state.events.map(event => <li key={event.id}><small>{formatTime(event.at)}</small><p>{event.message}</p></li>)}</ol>}</Drawer></div>;
}
