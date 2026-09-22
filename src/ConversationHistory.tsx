import { Button } from 'antd';
import type { Candidate } from '../shared/contracts';
import type { RunCommand } from './bridge';
import { formatTime } from './bridge';

const directionLabels = { incoming: '对方', outgoing: '我方', unknown: '发送方待确认' } as const;

export function ConversationHistory({ candidate, connected, busy, run }: {
  readonly candidate: Candidate;
  readonly connected: boolean;
  readonly busy: boolean;
  readonly run: RunCommand;
}) {
  const ready = connected && Boolean(candidate.platformUserId);
  return <section className="stack full-width" aria-label="会话历史">
    <div className="cluster">
      <Button size="small" disabled={busy || !ready} loading={busy}
        onClick={() => void run({ type: 'loadHistory', id: candidate.id })}>读取最近历史</Button>
      {Boolean(candidate.history?.length) && <Button size="small" disabled={busy || !ready}
        onClick={() => void run({ type: 'loadHistory', id: candidate.id, older: true })}>读取更早历史</Button>}
    </div>
    {!ready && <small>需要有效账号连接及平台用户标识后才能读取历史。</small>}
    {candidate.historyFetchedAt && <small>历史读取时间：{formatTime(candidate.historyFetchedAt)}</small>}
    <small>对方消息在左，我方消息在右；方向无法确认时单独标注。未调用已读回执接口，平台未读状态以平台显示为准。</small>
    <div className="history-messages" aria-label="历史消息列表">
      {candidate.history?.map(message => {
        const direction = message.direction ?? 'unknown';
        return <article className={`history-message history-message-${direction}`} key={message.id}
          aria-label={`${directionLabels[direction]}消息`}>
          <div className="history-message-meta"><strong>{directionLabels[direction]}</strong><time dateTime={message.at}>{formatTime(message.at)}</time></div>
          <p className="preserve-text">{message.text || '非文本消息，暂不能展示内容。'}</p>
        </article>;
      })}
    </div>
  </section>;
}
