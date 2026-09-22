import { z } from 'zod';
import type { APIRequestContext } from 'playwright';
import { ConnectorError, readEnvelope } from './connector-data';

const identifier = z.union([z.string().min(1).max(200), z.number().finite()]).transform(String);
export const attachmentInputSchema = z.object({ sessionId: identifier, resumeNumber: z.string().min(1).max(200), resumeLanguage: z.string().regex(/^[1-9]\d{0,3}$/), jobNumber: z.string().min(1).max(200).optional() });
export type AttachmentInput = z.input<typeof attachmentInputSchema>;
export type AttachmentResult = { readonly status: 'ready'; readonly attachment: { readonly url: string } } | { readonly status: 'blocked'; readonly reason: string };
type ReadPath = '/api/session' | '/api/im/session/list' | '/api/resume/detail' | '/api/resume/getAttachResumeInfo';
type Reader = (path: ReadPath, data?: Readonly<Record<string, unknown>>) => Promise<unknown>;
const blocked = (reason: string): AttachmentResult => ({ status: 'blocked', reason });
const accountSchema = z.object({ isHrPilotUser: z.boolean() });
const sessionSchema = z.object({ sessionId: identifier, sessionType: z.string(), resumeNumber: z.string(), resumeLanguage: z.union([z.string(), z.number()]).transform(String), jobNumber: z.string().nullish() });
const permissionSchema = z.object({ candidate: z.object({ state: z.string().min(1) }), flags: z.object({ attachResumeButton: z.string().min(1) }) });

export function attachmentUnavailableReason(status: string): string {
  switch (status) {
    case 'HIDE': return '平台隐藏了附件入口，当前无法确认有可下载附件。';
    case 'ASK_FOR_ATTACH_ON_DELETED': return '平台标记该附件已删除，需要对方重新发送后才能下载。';
    case 'WAITING_FOR_REPLY': return '附件请求正在等待对方发送，当前尚不可下载。';
    case 'GRAY_FOR_REPLY_TO_UNLOCK': return '平台要求先回复对方才可使用附件功能；软件未发送回复。';
    case 'GRAY_FOR_USER_REPLY_TO_UNLOCK': return '平台要求对方先回复才可使用附件功能，当前尚未开放下载。';
    case 'B_CHAT_WITHOUT_APPLY': return '平台要求对方投递或发送附件后才能查看，当前尚未开放下载。';
    case 'NO_REPLY_APPLY': return '平台尚未开放附件查看，需要在官方页面完成回复或索要流程；软件未发送消息。';
    default: {
      const label = /^[A-Za-z0-9_-]{1,60}$/.test(status) ? `（平台状态 ${status}）` : '';
      return `当前附件权限状态尚未确认${label}，未请求文件；不能据此判断附件不存在。`;
    }
  }
}

export async function inspectAttachmentUsing(read: Reader, raw: AttachmentInput): Promise<AttachmentResult> {
  const input = attachmentInputSchema.safeParse(raw);
  if (!input.success) return blocked('附件定位信息不完整，无法确认下载权限。');
  const account = accountSchema.safeParse(readEnvelope(await read('/api/session')));
  if (!account.success) return blocked('平台未返回明确的账号收费类型，无法确认免费下载。');
  if (account.data.isHrPilotUser) return blocked('该账号属于收费试点，现有信息不足以排除联系方式解锁，未请求附件。');
  const data = readEnvelope(await read('/api/im/session/list', { pageSize: 20, pageNo: 1, keyword: '', sessionType: '', states: [], groupSelectorVal: '', includeResume: true }));
  const rows = z.array(z.object({ sessionId: identifier }).passthrough()).safeParse(data);
  if (!rows.success) return blocked('平台会话列表格式不完整，无法确认附件权限。');
  const matches = rows.data.filter(row => row.sessionId === input.data.sessionId);
  if (matches.length !== 1) return blocked('当前首屏没有唯一匹配会话，请刷新会话后重试。');
  const session = sessionSchema.safeParse(matches[0]);
  if (!session.success) return blocked('平台未返回完整的会话定位信息，无法确认附件权限。');
  if (session.data.sessionType !== 'USER' || session.data.resumeNumber !== input.data.resumeNumber || session.data.resumeLanguage !== input.data.resumeLanguage || (input.data.jobNumber !== undefined && session.data.jobNumber !== input.data.jobNumber)) return blocked('平台会话或简历定位发生变化，请刷新后重试。');
  const locator = { resumeNumber: input.data.resumeNumber, resumeLanguage: input.data.resumeLanguage, ...(input.data.jobNumber ? { jobNumber: input.data.jobNumber } : {}) };
  const detail = permissionSchema.safeParse(readEnvelope(await read('/api/resume/detail', { ...locator, k: '', t: '', isOperator: 'rd', enterScene: 'IM_SESSION_DETAIL', isCampusWidget: false, isPreFetch: false })));
  if (!detail.success) return blocked('平台未返回完整的候选人状态及附件查看权限，未请求附件。');
  if (detail.data.candidate.state === 'INAPPROPRIATE') return blocked('候选人处于不合适状态，未撤销状态或请求附件。');
  if (detail.data.flags.attachResumeButton !== 'SHOW_ONLINE') return blocked(attachmentUnavailableReason(detail.data.flags.attachResumeButton));
  const info = z.object({ url: z.string().max(16000) }).safeParse(readEnvelope(await read('/api/resume/getAttachResumeInfo', { resumeNumber: input.data.resumeNumber, language: Number(input.data.resumeLanguage), ...(input.data.jobNumber ? { jobNumber: input.data.jobNumber } : {}) })));
  if (!info.success) return blocked('平台未返回可用的附件文件地址。');
  let url: URL;
  try { url = new URL(info.data.url); } catch (error) { if (error instanceof TypeError) return blocked('附件地址格式无效。'); throw error; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return blocked('附件地址不符合安全下载要求。');
  return { status: 'ready', attachment: { url: url.href } };
}

export async function inspectAttachmentWithContext(context: APIRequestContext, input: AttachmentInput): Promise<AttachmentResult> {
  return inspectAttachmentUsing(async (path, data) => {
    const response = await context.fetch(`https://rd6.zhaopin.com${path}`, { method: data ? 'POST' : 'GET', ...(data ? { data } : {}), headers: { 'y-zp-business-type': 'B' }, maxRedirects: 0 });
    try {
      if (response.status() === 401) throw new ConnectorError('expired', '智联登录已失效，请重新连接。');
      if (!response.ok()) throw new ConnectorError('platform', '附件权限读取被拒绝，未继续下载。');
      return await response.json();
    } finally { await response.dispose(); }
  }, input);
}
