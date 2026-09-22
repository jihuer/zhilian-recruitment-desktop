import { useState } from 'react';
import { Alert, Button, Input, Modal, Popconfirm, Tag } from 'antd';
import { BriefcaseBusiness, Plus, RefreshCw, Settings2 } from 'lucide-react';
import type { State } from '../shared/contracts';
import type { RunCommand } from './bridge';
import { formatTime } from './bridge';
import { EmptyState, Field, Metric, PageHeader, Panel, Status } from './primitives';

export function Accounts({ state, run, busy, openSettings }: { readonly state: State; readonly run: RunCommand; readonly busy: boolean; readonly openSettings: () => void }) {
  const [connecting, setConnecting] = useState(false);
  const [name, setName] = useState('');
  const connected = state.accounts.filter(account => account.status === 'connected').length;
  const connectionActive = ['opening', 'waiting', 'verifying'].includes(state.connection.phase);
  const connectButton = <Button type="primary" icon={<Plus size={16} />} disabled={connectionActive || busy} onClick={() => setConnecting(true)}>连接账号</Button>;
  return <main className="page"><PageHeader title="智联账号管理" description="连接招聘账号，统一管理岗位与招聘工作。" actions={<><Button icon={<Settings2 size={16} />} onClick={openSettings}>Chrome 设置</Button>{connectButton}</>} />
    <div className="metrics"><Metric label="已连接账号" value={connected} note="企业会话与岗位读取已验证" /><Metric label="监听中" value={0} note={state.capabilities.conversations ? '会话摘要可手动同步' : '会话同步待接入验证'} /><Metric label="未监听" value={connected} note="当前未开启实时监听" /></div>
    {state.connection.message && <Alert showIcon type={state.connection.phase === 'error' ? 'error' : 'info'} message={state.connection.message} action={connectionActive && <Button size="small" disabled={busy} onClick={() => void run({ type: 'cancelConnect' })}>取消登录</Button>} />}
    <Panel title="账号列表" actions={<Button icon={<RefreshCw size={14} />} disabled={busy} onClick={() => void run({ type: 'state' })}>刷新</Button>}>
      {state.accounts.length === 0 ? <EmptyState title="连接智联账号后开始使用" description="在独立 Chrome 中完成企业登录，连接完成后窗口将自动关闭。" action={connectButton} /> : <div className="account-list">{state.accounts.map(account => <article className="account-row" key={account.id}>
        <span className="account-avatar"><BriefcaseBusiness size={22} /></span><div className="account-info"><h3>{account.name}</h3><p className="muted">{account.company || '企业信息待补充'}</p><div><small>最近同步：{formatTime(account.lastSync)}</small></div><div><small>身份验证：{account.identityVerifiedAt ? formatTime(account.identityVerifiedAt) : '尚未验证'}</small></div></div><div className="stack account-status"><Status value={account.status} /><Tag>未监听</Tag></div><div className="cluster account-actions"><Button disabled={busy || account.status === 'disconnected'} onClick={() => void run({ type: 'verifyIdentity', id: account.id })}>验证账号身份</Button><Button disabled={busy || account.status === 'disconnected'} onClick={() => void run({ type: 'syncJobs', id: account.id })}>同步岗位</Button><Popconfirm title="断开此账号？" description="连接凭证将移除，关联任务会停止。" onConfirm={() => void run({ type: 'disconnect', id: account.id })} okText="断开" cancelText="取消"><Button danger disabled={busy}>断开账号</Button></Popconfirm></div>
      </article>)}</div>}
    </Panel>
    {state.jobs.length > 0 && <Panel title={`招聘岗位 · ${state.jobs.length}`}><div className="jobs-grid">{state.jobs.map(job => <article className="job-tile" key={`${job.accountId}-${job.id}`}><div className="cluster"><BriefcaseBusiness size={16} /><h3>{job.title}</h3></div><p className="muted">{[job.city, job.salary].filter(Boolean).join(' · ') || '平台未提供地区或薪资'}</p><small>{state.accounts.find(account => account.id === job.accountId)?.name} · {job.status || '状态未提供'}</small></article>)}</div></Panel>}
    <Modal title="连接智联招聘账号" open={connecting} onCancel={() => setConnecting(false)} confirmLoading={busy} okText="打开 Chrome 登录" cancelText="取消" okButtonProps={{ disabled: !name.trim() || connectionActive }} onOk={() => { void run({ type: 'connect', name: name.trim() }).then(ok => { if (ok) { setConnecting(false); setName(''); } }); }}><div className="stack"><p className="muted">请在打开的独立 Chrome 窗口中自行完成登录。无需向软件输入密码或验证码。</p><Field label="账号昵称" htmlFor="connection-name" help="仅用于本地识别，例如：上海招聘组"><Input id="connection-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="输入账号昵称" autoFocus /></Field></div></Modal>
  </main>;
}
