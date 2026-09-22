import { useState } from 'react';
import { Alert, Button, Modal, Tag } from 'antd';
import type { Candidate, ReplyAttempt, State } from '../shared/contracts';
import type { RunCommand } from './bridge';
import { formatTime } from './bridge';

const attemptLabels = {
  generating: '正在生成', drafted: '草稿已生成', sending: '正在发送',
  accepted: '平台接受，待核对', confirmed: '平台历史已确认',
  uncertain: '结果不确定，已停止', failed: '处理失败', discarded: '已丢弃',
} as const satisfies Record<ReplyAttempt['status'], string>;
const statusLabels = { enabled: '已开启', paused: '已暂停', off: '已关闭' } as const;

export function AutoReplyControls({ candidate, state, busy, run }: {
  readonly candidate: Candidate;
  readonly state: State;
  readonly busy: boolean;
  readonly run: RunCommand;
}) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const config = state.autoReplies.find(item => item.candidateId === candidate.id);
  const account = state.accounts.find(item => item.id === candidate.accountId);
  const job = state.jobs.find(item => item.id === candidate.jobId && item.accountId === candidate.accountId);
  const jobReady = Boolean(job?.status.trim()) && !/WITHDRAWN|CLOSED|OFFLINE|STOPPED|DELETED|关闭|下线|停止|撤回|删除|结束|招满/i.test(job?.status ?? '');
  const locatorReady = Boolean(candidate.platformUserId && candidate.platformSessionId && candidate.platformPeerPartnerId);
  const ready = candidate.source === 'platform' && account?.status === 'connected' && jobReady && candidate.mode !== 'human' && locatorReady;
  const attempts = state.replyAttempts.filter(item => item.candidateId === candidate.id)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const unresolved = attempts.some(item => item.status === 'accepted' || item.status === 'uncertain' || item.status === 'sending');
  const latest = attempts[0];
  const active = config?.status === 'enabled';
  const canEnable = ready && !busy && !unresolved;
  const language = candidate.platformResumeLanguage?.trim() ?? '';
  const resumeReady = Boolean(candidate.platformResumeNumber?.trim()) && /^\d+$/.test(language) && Number.isSafeInteger(Number(language));
  const canEnableSend = canEnable && resumeReady;
  const canCheckAccess = candidate.source === 'platform' && account?.status === 'connected' && Boolean(candidate.platformSessionId) && resumeReady;

  return <section className="auto-reply-panel stack" aria-label="自动回复控制">
    <div className="cluster"><h3>自动回复</h3><Tag color={active ? 'blue' : 'default'}>{statusLabels[config?.status ?? 'off']}</Tag>{config && <Tag>{config.mode === 'send' ? '自动发送' : '自动草稿'}</Tag>}</div>
    <small>默认关闭。开启后每 90 秒检查此会话的新消息，旧消息跳过；退出软件或重启后暂停。</small>
    <div className="cluster">
      <Button disabled={!canEnable || (active && config?.mode === 'draft')} onClick={() => void run({ type: 'autoReplyAction', id: candidate.id, action: 'enableDraft' })}>自动草稿</Button>
      <Button type="primary" disabled={!canEnableSend || (active && config?.mode === 'send')} onClick={() => { setFailed(false); setConfirming(true); }}>自动发送</Button>
      <Button disabled={busy || !active} onClick={() => void run({ type: 'autoReplyAction', id: candidate.id, action: 'pause' })}>暂停</Button>
      <Button disabled={busy || !config || config.status === 'off'} onClick={() => void run({ type: 'autoReplyAction', id: candidate.id, action: 'stop' })}>停止</Button>
      <Button disabled={busy || !ready || !active || unresolved} onClick={() => void run({ type: 'autoReplyAction', id: candidate.id, action: 'check' })}>立即检查</Button>
      <Button disabled={busy || account?.status !== 'connected' || !unresolved} onClick={() => void run({ type: 'autoReplyAction', id: candidate.id, action: 'reconcile' })}>核对结果</Button>
      <Button disabled={busy || !canCheckAccess} onClick={() => void run({ type: 'checkReplyAccess', id: candidate.id })}>检查发送权限</Button>
    </div>
    {ready && !resumeReady && <small>自动发送还需要完整的简历标识，请先同步会话摘要。</small>}
    <small>检查发送权限只读取平台权限，不生成或发送消息，也不等同于发送链路实测通过。</small>
    {!ready && <small>开启前请确认：平台会话标识齐全、账号有效、已关联有效岗位，且未处于人工接管。</small>}
    {config?.nextCheckAt && active && <small>下次检查：{formatTime(config.nextCheckAt)}</small>}
    {config?.reason && <p className="task-reason">{config.reason}</p>}
    {unresolved && <Alert type="warning" showIcon message="发送结果待核对，请勿重复发送。" />}
    {latest && <article className="auto-reply-attempt stack"><div className="cluster"><strong>最新处理记录</strong><Tag>{attemptLabels[latest.status]}</Tag></div><small>{formatTime(latest.updatedAt)}</small>{latest.text && <p className="preserve-text">{latest.text}</p>}{latest.reason && <p className="muted">{latest.reason}</p>}{latest.status === 'confirmed' && <small>已在平台历史中确认此消息，不代表对方已读。</small>}</article>}
    <Modal title="开启此会话的自动发送？" open={confirming} onCancel={() => setConfirming(false)}
      okText="确认开启自动发送" cancelText="取消" confirmLoading={busy} okButtonProps={{ disabled: !canEnableSend }}
      onOk={() => { void run({ type: 'autoReplyAction', id: candidate.id, action: 'enableSend' }).then(ok => { if (ok) setConfirming(false); else setFailed(true); }); }}>
      <div className="stack"><p>仅对 <strong>{candidate.name}</strong> 在开启后的新消息生成并自动发送回复，旧消息跳过。每 90 秒检查一次，不是实时监听。</p><p>结果不确定时，自动停止并等待核对。<br />你可以暂停、停止或人工接管。<br />软件退出或重启后保持暂停。</p><p className="muted">请确认岗位规则已准确填写。此操作仅授权当前会话，不代表平台发送通道已经通过实测验证。</p>{failed && <Alert type="error" message="未能开启，请关闭此窗口查看操作提示。" />}</div>
    </Modal>
  </section>;
}
