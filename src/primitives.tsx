import type { ReactNode } from 'react';
import { Button, Input, Select, Tag } from 'antd';
import { Inbox, Plus } from 'lucide-react';
import type { Account } from '../shared/contracts';

export function PageHeader({ title, description, actions }: { readonly title: string; readonly description: string; readonly actions?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1><p>{description}</p></div><div className="cluster">{actions}</div></header>;
}
export function Panel({ title, actions, children, className = '' }: { readonly title: ReactNode; readonly actions?: ReactNode; readonly children: ReactNode; readonly className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-heading"><h2>{title}</h2><div className="cluster">{actions}</div></div><div className="panel-body">{children}</div></section>;
}
export function EmptyState({ title, description, action }: { readonly title: string; readonly description: string; readonly action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Inbox size={28} strokeWidth={1.5} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Metric({ label, value, note }: { readonly label: string; readonly value: number; readonly note: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}
export function Field({ label, htmlFor, children, help }: { readonly label: string; readonly htmlFor?: string; readonly children: ReactNode; readonly help?: string }) {
  return <div className="field"><label htmlFor={htmlFor}>{label}</label>{children}{help && <small>{help}</small>}</div>;
}
export function TaskSection({ number, title, children, actions }: { readonly number: string; readonly title: string; readonly children: ReactNode; readonly actions?: ReactNode }) {
  return <Panel title={<><span className="section-number">{number}</span>{title}</>} actions={actions}>{children}</Panel>;
}
export function AccountSelector({ accounts, value, onChange, id = 'account-select' }: { readonly accounts: readonly Account[]; readonly value: string; readonly onChange: (value: string) => void; readonly id?: string }) {
  return <Select id={id} value={value || null} onChange={onChange} placeholder="请选择已连接账号" options={accounts.map(account => ({ value: account.id, label: account.name, disabled: account.status !== 'connected' }))} notFoundContent="暂无已连接账号" />;
}
const statusLabels = { connected: '已连接', unverified: '待验证', expired: '登录已过期', disconnected: '已断开', running: '运行中', paused: '已暂停', stopped: '已停止', completed: '已完成', blocked: '需要处理' } as const;
export function Status({ value }: { readonly value: keyof typeof statusLabels }) {
  const color = value === 'connected' || value === 'completed' ? 'green' : value === 'running' ? 'blue' : value === 'blocked' || value === 'expired' ? 'orange' : 'default';
  return <Tag color={color}>{statusLabels[value]}</Tag>;
}
export function PrimitiveShowcase() {
  return <main className="page"><PageHeader title="组件与状态" description="招聘工作台 · 可复用界面基础" actions={<Button type="primary" icon={<Plus size={16} />}>主操作</Button>} /><div className="metrics"><Metric label="已连接账号" value={0} note="实际连接的智联账号" /></div><Panel title="表单与操作"><div className="form-grid"><Field label="账号昵称" htmlFor="showcase-name"><Input id="showcase-name" placeholder="请输入昵称" /></Field><Field label="错误状态" htmlFor="showcase-error"><Input id="showcase-error" status="error" aria-invalid="true" placeholder="请补充内容" /></Field></div><div className="cluster"><Button>默认按钮</Button><Button loading>正在处理</Button><Button disabled>暂不可用</Button><Status value="connected" /><Status value="expired" /></div></Panel><TaskSection number="01" title="账号与职位"><EmptyState title="连接智联账号后开始使用" description="完成登录后，招聘岗位会显示在这里。" action={<Button type="primary">连接账号</Button>} /></TaskSection></main>;
}
