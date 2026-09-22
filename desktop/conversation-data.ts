import { z } from 'zod';
import { ConnectorError, readEnvelope } from './connector-data';

const identifier = z.union([z.string().min(1), z.number().finite()]).transform(String);
const count = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().nonnegative());
const itemSchema = z.object({
  sessionType: z.string(),
  sessionId: identifier,
  userId: identifier.nullish(),
  peerPartnerId: identifier.nullish(),
  resumeNumber: z.string().max(200).nullish(),
  resumeLanguage: z.union([z.string().max(20),z.number().finite()]).nullish(),
  jobNumber: z.string().max(200).nullish(),
  name: z.string().max(100).nullish(),
  jobTitle: z.string().nullish(),
  unreadCount: count.nullish(),
  lastSentence: z.string().nullish(),
});
const summarySchema = z.object({ text: z.string().max(12000).nullish(), sendTime: z.union([z.number().finite(), z.string()]).nullish() });
export type ConversationSummary = {
  readonly id: string;
  readonly platformSessionId: string;
  readonly platformUserId?: string;
  readonly platformPeerPartnerId?: string;
  readonly platformResumeNumber?: string;
  readonly platformResumeLanguage?: string;
  readonly platformJobNumber?: string;
  readonly name: string;
  readonly message: string;
  readonly unreadCount: number;
  readonly platformJobTitle: string;
  readonly platformUpdatedAt: string;
};

function parseSummary(input: string | null | undefined): { readonly message: string; readonly platformUpdatedAt: string } {
  if (!input) return { message: '', platformUpdatedAt: '' };
  let value: unknown;
  try { value = JSON.parse(input); }
  catch (error) {
    if (error instanceof SyntaxError) return { message: '摘要暂不可解析', platformUpdatedAt: '' };
    throw error;
  }
  const parsed = summarySchema.safeParse(value);
  if (!parsed.success) return { message: '摘要暂不可解析', platformUpdatedAt: '' };
  const time = parsed.data.sendTime;
  const timestamp = time == null || time === '' ? Number.NaN : Number(time);
  const date = new Date(timestamp);
  return { message: parsed.data.text ?? '', platformUpdatedAt: Number.isFinite(timestamp) && !Number.isNaN(date.getTime()) ? date.toISOString() : '' };
}

export function parseConversationSummaries(value: unknown, accountId: string): ConversationSummary[] {
  const envelope = readEnvelope(value);
  const rows = z.array(z.object({ sessionType: z.string() }).passthrough()).safeParse(envelope);
  if (!rows.success) throw new ConnectorError('format', '智联会话列表格式发生变化，已停止同步。');
  const result: ConversationSummary[] = [];
  const seen = new Set<string>();
  for (const row of rows.data) {
    if (row.sessionType !== 'USER') continue;
    const parsed = itemSchema.safeParse(row);
    if (!parsed.success) throw new ConnectorError('format', '智联会话项目格式发生变化，已停止同步。');
    const item = parsed.data;
    if (seen.has(item.sessionId)) continue;
    seen.add(item.sessionId);
    result.push({ id: `${accountId}:session:${item.sessionId}`, platformSessionId: item.sessionId, ...(item.userId ? { platformUserId: item.userId } : {}), ...(item.peerPartnerId?{platformPeerPartnerId:item.peerPartnerId}:{}), ...(item.resumeNumber?{platformResumeNumber:item.resumeNumber}:{}), ...(item.resumeLanguage!=null?{platformResumeLanguage:String(item.resumeLanguage)}:{}), ...(item.jobNumber?{platformJobNumber:item.jobNumber}:{}), name: item.name || '未提供姓名', unreadCount: item.unreadCount ?? 0, platformJobTitle: item.jobTitle ?? '', ...parseSummary(item.lastSentence) });
  }
  return result;
}
