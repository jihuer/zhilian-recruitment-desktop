import { z } from 'zod';
import type { APIRequestContext } from 'playwright';
import { ConnectorError, envelopeSchema, readEnvelope } from './connector-data';

const id = z.union([z.string().min(1).max(200), z.number().finite()]).transform(String);
const targetSchema = z.object({ sessionId: z.string().min(1).max(200), resumeNumber: z.string().min(1).max(200), resumeLanguage: z.string().regex(/^[1-9]\d{0,3}$/), jobNumber: z.string().min(1).max(200).optional() });
export type ReplyTarget = z.infer<typeof targetSchema>;
export type ReplyInput = { readonly target: ReplyTarget; readonly content: string; readonly sendMessageId: string };
export type ReplyPermission = { readonly allowed: boolean; readonly reason: string };
export class ReplyUncertainError extends Error {
  readonly name = 'ReplyUncertainError';
  constructor() { super('消息发送结果待确认，请先核对平台历史，禁止自动重发。'); }
}
type ReadPath = '/api/session' | '/api/im/session/list' | '/api/im/session/detail' | '/api/resume/detail';
export type ReplyTransport = {
  readonly read: (path: ReadPath, data?: Readonly<Record<string, unknown>>) => Promise<unknown>;
  readonly send: (data: { readonly content: string; readonly sessionId: string; readonly sendMessageId: string }) => Promise<{ readonly status: number; readonly body: unknown }>;
};
const accountSchema = z.object({ inNewRegisterFlow: z.boolean(), isHrPilotUser: z.boolean() });
const sessionSchema = z.object({ sessionId: id, sessionType: z.string(), resumeNumber: z.string(), resumeLanguage: z.union([z.string(), z.number()]).transform(String), jobNumber: z.string().nullish(), referType: z.string(), exclusiveCompany: z.boolean(), silence: z.boolean(), closed: z.boolean(), mute: z.boolean(), blocking: z.boolean(), lockSession: z.unknown().optional(), status: z.unknown().optional() });
const deny = (reason: string): ReplyPermission => ({ allowed: false, reason });
function invalidFields(scope: string, issues: readonly { readonly path: readonly PropertyKey[] }[]): ReplyPermission {
  const paths = [...new Set(issues.map(issue => issue.path.filter((part): part is string => typeof part === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]{0,59}$/.test(part)).join('.')).filter(Boolean))].slice(0, 20);
  return deny(`${scope}字段缺失或类型待核对${paths.length ? `：${paths.join('、')}` : ''}；未允许发送。`);
}


export async function checkReplyPermissionUsing(transport: ReplyTransport, raw: ReplyTarget): Promise<ReplyPermission> {
  const parsed = targetSchema.safeParse(raw);
  if (!parsed.success) return deny('会话定位信息不完整，未允许发送。');
  const target = parsed.data;
  const account = accountSchema.safeParse(readEnvelope(await transport.read('/api/session')));
  if (!account.success) return invalidFields('账号', account.error.issues);
  if (account.data.inNewRegisterFlow || account.data.isHrPilotUser) return deny('账号处于新注册或收费试点流程，未执行解锁或发送。');
  const list = z.array(z.object({ sessionId: id }).passthrough()).safeParse(readEnvelope(await transport.read('/api/im/session/list', { pageSize: 20, pageNo: 1, keyword: '', sessionType: '', states: [], groupSelectorVal: '', includeResume: true })));
  if (!list.success) return invalidFields('会话列表', list.error.issues);
  const matches = list.data.filter(row => row.sessionId === target.sessionId);
  if (matches.length !== 1) return deny('当前首屏没有唯一匹配会话，未允许发送。');
  const original = z.object({ sessionId: id, sessionType: z.string(), resumeNumber: z.string(), resumeLanguage: z.union([z.string(), z.number()]).transform(String), jobNumber: z.string().nullish(), referType: z.string() }).passthrough().safeParse(matches[0]);
  if (!original.success) return invalidFields('会话定位', original.error.issues);
  if (original.data.sessionType !== 'USER' || original.data.resumeNumber !== target.resumeNumber || original.data.resumeLanguage !== target.resumeLanguage || (target.jobNumber !== undefined && original.data.jobNumber !== target.jobNumber)) return deny('目标会话或简历已变化，未允许发送。');
  const fresh = z.object({ sessionId: id }).passthrough().safeParse(readEnvelope(await transport.read('/api/im/session/detail', { sessionId: target.sessionId, isCampusWidget: false, markRead: false, includeResumeDetail: true })));
  if (!fresh.success) return invalidFields('会话详情', fresh.error.issues);
  if (fresh.data.sessionId !== target.sessionId) return deny('平台返回的会话详情身份不一致，未允许发送。');
  const selected = sessionSchema.safeParse({ ...original.data, ...fresh.data, referType: original.data.referType });
  if (!selected.success) return invalidFields('会话权限', selected.error.issues);
  const session = selected.data;
  if (session.sessionType !== 'USER' || session.resumeNumber !== target.resumeNumber || session.resumeLanguage !== target.resumeLanguage || (target.jobNumber !== undefined && session.jobNumber !== target.jobNumber)) return deny('目标会话或简历已变化，未允许发送。');
  if (session.exclusiveCompany || session.silence || session.closed || session.mute || session.blocking) return deny('会话处于独占、关闭、静音或屏蔽状态，未解除限制或发送。');
  if (session.referType === 'STAFF_DIRECT_RECOMMEND' || session.referType === 'BATCH_APPLY') {
    if (typeof session.lockSession !== 'boolean') return deny('单向或批量投递会话锁定状态未知，未允许发送。');
    if (session.lockSession) return deny('会话存在单向或批量投递锁定，未执行解锁或发送。');
  }
  const detail = z.object({ candidate: z.object({ sourceType: z.string().min(1) }) }).safeParse(readEnvelope(await transport.read('/api/resume/detail', { resumeNumber: target.resumeNumber, resumeLanguage: target.resumeLanguage, ...(target.jobNumber ? { jobNumber: target.jobNumber } : {}), k: '', t: '', isOperator: 'rd', enterScene: 'IM_SESSION_DETAIL', isCampusWidget: false, isPreFetch: false })));
  if (!detail.success) return invalidFields('候选人', detail.error.issues);
  if (detail.data.candidate.sourceType === 'YUELIAO') {
    if (typeof session.status !== 'string' || !session.status) return deny('候选人接收状态未知，未允许发送。');
    if (session.status === 'REJECTED') return deny('对方已拒绝接收，未发送消息。');
  }
  return { allowed: true, reason: '已核对当前普通会话权限；发送后仍须核对平台确认。' };
}

export async function sendReplyUsing(transport: ReplyTransport, input: ReplyInput, beforeSend: () => boolean): Promise<void> {
  const parsed = z.object({ target: targetSchema, content: z.string().trim().min(1).max(4000), sendMessageId: z.string().regex(/^[a-fA-F0-9]{32}$/) }).safeParse(input);
  if (!parsed.success) throw new ConnectorError('format', '发送内容、会话或消息标识无效。');
  const permission = await checkReplyPermissionUsing(transport, parsed.data.target);
  if (!permission.allowed) throw new ConnectorError('platform', permission.reason);
  if (!beforeSend()) throw new ConnectorError('cancelled', '自动回复已停用，消息未发送。');
  let response: { readonly status: number; readonly body: unknown };
  try { response = await transport.send({ content: parsed.data.content, sessionId: parsed.data.target.sessionId, sendMessageId: parsed.data.sendMessageId }); }
  catch (error) { if (error instanceof ReplyUncertainError) throw error; throw new ReplyUncertainError(); }
  if (response.status === 401) throw new ConnectorError('expired', '智联拒绝发送：登录已失效。');
  if (response.status < 200 || response.status >= 300) throw new ReplyUncertainError();
  const body = envelopeSchema.safeParse(response.body);
  if (!body.success) throw new ReplyUncertainError();
  if (String(body.data.code) === '800004') throw new ConnectorError('platform', '对方拒收消息，已停止发送；不得重试。');
  if (String(body.data.code) === '800003') throw new ConnectorError('platform', '平台拒绝消息内容，已停止发送；不得自动重试。');
  readEnvelope(body.data);
}

export function replyTransport(context: APIRequestContext): ReplyTransport {
  return {
    read: async (path, data) => {
      const response = await context.fetch(`https://rd6.zhaopin.com${path}`, { method: data ? 'POST' : 'GET', ...(data ? { data } : {}), headers: { 'y-zp-business-type': 'B' }, maxRedirects: 0, maxRetries: 0, timeout: 20_000 });
      try {
        if (response.status() === 401) throw new ConnectorError('expired', '智联登录已失效，请重新连接。');
        if (!response.ok()) throw new ConnectorError('platform', '发送权限读取被拒绝，未发送消息。');
        return await response.json();
      } finally { await response.dispose(); }
    },
    send: async data => {
      const response = await context.post('https://rd6.zhaopin.com/api/im/sendText', { data, headers: { 'y-zp-business-type': 'B' }, maxRedirects: 0, maxRetries: 0, timeout: 20_000 });
      try { return { status: response.status(), body: await response.json() }; }
      finally { await response.dispose(); }
    },
  };
}
