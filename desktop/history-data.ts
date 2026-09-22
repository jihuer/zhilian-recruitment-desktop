import { z } from 'zod';
import { ConnectorError, readEnvelope } from './connector-data';

const identifier = z.union([z.string().min(1).max(200), z.number().finite()]).transform(String);
const timestamp = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().finite().nonnegative()).refine(value => !Number.isNaN(new Date(value).getTime()));
const messageSchema = z.object({
  idServer: identifier.nullish(),
  sendMessageId: identifier.nullish(),
  type: z.string().min(1).max(100),
  text: z.string().max(12000).nullish(),
  time: timestamp,
  from: identifier,
}).refine(value => Boolean(value.idServer || value.sendMessageId)).refine(value => value.type !== 'text' || typeof value.text === 'string');
const historySchema = z.object({ messages: z.array(messageSchema).max(1000) });
export type HistoryMessage = {
  readonly id: string;
  readonly clientMessageId?: string;
  readonly text: string;
  readonly at: string;
  readonly senderId: string;
  readonly kind: string;
  readonly direction?: 'incoming'|'outgoing'|'unknown';
};
function present(type: string, text: string | null | undefined): { readonly kind: string; readonly text: string } {
  switch (type) {
    case 'text': return { kind: 'text', text: text ?? '' };
    case 'custom': return { kind: 'custom', text: '【卡片消息，请在智联查看】' };
    case 'image': return { kind: 'image', text: '【图片消息，请在智联查看】' };
    case 'video': return { kind: 'video', text: '【视频消息，请在智联查看】' };
    case 'notification': return { kind: 'notification', text: '【系统通知，请在智联查看】' };
    case 'deleteMsg': return { kind: 'deleteMsg', text: '【消息撤回通知】' };
    default: return { kind: 'unknown', text: '【暂不支持的消息类型，请在智联查看】' };
  }
}
export function parseHistory(value: unknown): HistoryMessage[] {
  const parsed = historySchema.safeParse(readEnvelope(value));
  if (!parsed.success) throw new ConnectorError('format', '智联历史消息格式发生变化，已停止读取。');
  const seenServer = new Set<string>();
  const seenSent = new Set<string>();
  const result: HistoryMessage[] = [];
  for (const item of parsed.data.messages) {
    if ((item.idServer && seenServer.has(item.idServer)) || (item.sendMessageId && seenSent.has(item.sendMessageId))) continue;
    const id = item.idServer || item.sendMessageId;
    if (!id) throw new ConnectorError('format', '智联历史消息缺少标识，已停止读取。');
    if (item.idServer) seenServer.add(item.idServer);
    if (item.sendMessageId) seenSent.add(item.sendMessageId);
    result.push({ id, ...(item.sendMessageId?{clientMessageId:item.sendMessageId}:{}), at: new Date(item.time).toISOString(), senderId: item.from, ...present(item.type, item.text) });
  }
  return result.sort((a, b) => a.at.localeCompare(b.at));
}
