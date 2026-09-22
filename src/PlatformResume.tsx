import { Button } from 'antd';
import type { Candidate } from '../shared/contracts';
import type { RunCommand } from './bridge';
import { formatTime } from './bridge';

export function PlatformResume({ candidate, connected, busy, run }: {
  readonly candidate: Candidate;
  readonly connected: boolean;
  readonly busy: boolean;
  readonly run: RunCommand;
}) {
  const language = candidate.platformResumeLanguage?.trim() ?? '';
  const hasLocator = Boolean(candidate.platformResumeNumber?.trim())
    && /^\d+$/.test(language) && Number.isSafeInteger(Number(language));

  return <section className="stack full-width" aria-label="在线简历">
    <div className="cluster">
      <h3>在线简历</h3>
      <Button size="small" loading={busy} disabled={busy || !connected || !hasLocator}
        onClick={() => void run({ type: 'loadResume', id: candidate.id })}>
        读取在线简历
      </Button>
    </div>
    <div className="cluster"><Button loading={busy} disabled={busy || !connected || !hasLocator} onClick={() => void run({type:'downloadAttachment',id:candidate.id})}>下载附件简历</Button><small>下载对方的原文件；先核对平台权限，需要解锁时停止。</small></div>
    <small>在线卡片与附件文件分开。附件未提供或不可访问时会显示原因。</small>
    {!hasLocator && <small>简历标识尚未齐全，请先同步会话摘要。</small>}
    {!connected && <small>请先恢复账号连接，再读取在线简历。</small>}
    {candidate.platformResumeFetchedAt && <small>读取时间：{formatTime(candidate.platformResumeFetchedAt)}</small>}
    {candidate.platformResumeText
      ? <p className="message-bubble full-width preserve-text">{candidate.platformResumeText}</p>
      : <small>{candidate.platformResumeFetchedAt ? '本次读取没有可显示的简历文字。' : '尚未读取平台简历卡片。'}</small>}
  </section>;
}
