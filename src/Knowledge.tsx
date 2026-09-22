import { useState } from 'react';
import { Alert, Button, Input, Modal, Popconfirm, Select, Tag } from 'antd';
import { Plus } from 'lucide-react';
import type { State } from '../shared/contracts';
import { KnowledgeDocumentSchema, type KnowledgeDocument } from '../shared/knowledge';
import { Field } from './primitives';

type Props = {
  readonly documents: readonly KnowledgeDocument[];
  readonly jobs: State['jobs'];
  readonly accounts: State['accounts'];
  readonly busy: boolean;
  readonly save: (document: KnowledgeDocument) => Promise<boolean>;
  readonly remove: (id: string) => Promise<boolean>;
  readonly close: () => void;
};

export function Knowledge({ documents, jobs, accounts, busy, save, remove, close }: Props) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [selected, setSelected] = useState('');
  const [scope, setScope] = useState<KnowledgeDocument['scope']>('company');
  const [jobId, setJobId] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const accountJobs = jobs.filter(job => job.accountId === accountId);
  const available = documents.filter(document => document.accountId === accountId);
  function reset() {
    setSelected(''); setScope('company'); setJobId(''); setTitle(''); setText(''); setError(''); setSaved(false);
  }
  function edit(id: string) {
    const document = available.find(item => item.id === id);
    if (!document) return;
    setSelected(document.id); setScope(document.scope); setJobId(document.jobId);
    setTitle(document.title); setText(document.text); setError(''); setSaved(false);
  }
  async function submit() {
    setSaved(false);
    const parsed = KnowledgeDocumentSchema.safeParse({ id: selected || crypto.randomUUID(), accountId, scope, jobId: scope === 'company' ? '' : jobId, title, text, updatedAt: new Date().toISOString() });
    if (!parsed.success) { setError('请选择所属账号、适用岗位，并填写标题和知识正文。'); return; }
    if (!accounts.some(account => account.id === accountId) || (scope === 'job' && !accountJobs.some(job => job.id === jobId))) {
      setError('所属账号或岗位已变更，请重新选择。'); return;
    }
    setError('');
    if (await save(parsed.data)) { setSelected(parsed.data.id); setSaved(true); }
  }
  return <Modal title="公司与岗位知识库" open onCancel={close} width="min(800px, calc(100vw - 32px))" footer={<div className="cluster"><Button onClick={close}>关闭</Button><Button type="primary" loading={busy} disabled={busy || !accountId} onClick={() => void submit()}>保存资料</Button></div>}>
    <div className="stack">
      <Alert type="info" showIcon message="公司共享，岗位独立" description="仅同账号使用，不会公开。" />
      <Field label="所属招聘账号" htmlFor="knowledge-account"><Select id="knowledge-account" disabled={busy} value={accountId || null} placeholder="先连接一个招聘账号" options={accounts.map(account => ({ value: account.id, label: account.company || account.name }))} onChange={value => { setAccountId(value); reset(); }} /></Field>
      <div className="cluster"><h3>已保存资料 · {available.length}</h3><Button icon={<Plus size={16} />} disabled={busy || !accountId} onClick={reset}>新增资料</Button></div>
      <Field label="选择资料进行编辑" htmlFor="knowledge-document"><Select id="knowledge-document" disabled={busy || !available.length} value={selected || null} placeholder={available.length ? '选择已保存资料，或新增资料' : '暂无资料，请在下方填写'} options={available.map(document => ({ value: document.id, label: `${document.scope === 'company' ? '公司共享' : jobs.find(job => job.id === document.jobId)?.title || '岗位已移除'} · ${document.title}` }))} onChange={edit} /></Field>
      <div className="dialog-divider" />
      <div className="form-grid">
        <Field label="适用范围" htmlFor="knowledge-scope"><Select id="knowledge-scope" disabled={busy} value={scope} options={[{ value: 'company', label: '公司共享知识' }, { value: 'job', label: '仅当前岗位' }]} onChange={value => { setScope(value === 'job' ? 'job' : 'company'); setJobId(''); setSaved(false); }} /></Field>
        {scope === 'job' && <Field label="适用岗位" htmlFor="knowledge-job"><Select id="knowledge-job" disabled={busy} value={jobId || null} placeholder="请选择岗位" options={accountJobs.map(job => ({ value: job.id, label: `${job.title} · ${job.city}` }))} onChange={value => { setJobId(value); setSaved(false); }} notFoundContent="请先同步该账号的岗位" /></Field>}
      </div>
      <Field label="资料标题" htmlFor="knowledge-title"><Input id="knowledge-title" disabled={busy} maxLength={120} value={title} placeholder="例如：公司介绍与福利、销售岗位薪酬说明" onChange={event => { setTitle(event.target.value); setSaved(false); }} /></Field>
      <Field label="知识正文" htmlFor="knowledge-text" help="粘贴经过确认的公司资料、岗位要求或问答。每份最多 100,000 字；保存后生成草稿时自动检索相关内容。"><Input.TextArea id="knowledge-text" disabled={busy} rows={10} style={{ marginBottom: 'var(--s4)' }} maxLength={100000} showCount value={text} placeholder="填写已确认的事实、适用条件与生效时间。" onChange={event => { setText(event.target.value); setSaved(false); }} /></Field>
      {error && <Alert type="error" showIcon message={error} />}
      {saved && <div role="status"><Tag color="green">已保存，后续生成使用最新内容</Tag></div>}
      <div className="form-actions">
        {selected && <Popconfirm title="删除这份知识资料？" description="删除后不再用于后续回复检索。" okText="删除" cancelText="取消" onConfirm={async () => { if (await remove(selected)) reset(); }}><Button danger disabled={busy}>删除资料</Button></Popconfirm>}
      </div>
    </div>
  </Modal>;
}
