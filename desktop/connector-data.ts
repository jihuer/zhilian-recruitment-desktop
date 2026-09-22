import { z } from 'zod';
import type { Job } from '../shared/contracts';

export class ConnectorError extends Error {
  readonly name = 'ConnectorError';
  constructor(readonly code: 'expired' | 'cancelled' | 'timeout' | 'busy' | 'platform' | 'format' | 'browser', message: string) { super(message); }
}
const scalar = z.union([z.string(), z.number()]);
export const querySchema = z.object({
  activeJobNumber: z.union([z.string().max(200), z.number(), z.null()]).optional(),
  includingHotJob: z.union([z.boolean(), z.number(), z.string().max(20)]).optional(),
}).strict();
const cookieSchema = z.object({ name: z.string(), value: z.string(), domain: z.string().refine(isZhilianDomain), path: z.string(), expires: z.number(), httpOnly: z.boolean(), secure: z.boolean(), sameSite: z.enum(['Strict', 'Lax', 'None']), partitionKey: z.string().optional() });
export const searchSchema = z.string().max(2000).refine(value => (value === '' || /^\?[^#]*$/.test(value)) && [...new URLSearchParams(value).keys()].every(key => !/token|auth|secret|sign|key|session|code/i.test(key)));
export const sessionSchema = z.object({ version: z.literal(1), cookies: z.array(cookieSchema), query: querySchema, search: searchSchema.default('') });
export type Session = z.infer<typeof sessionSchema>;
export const envelopeSchema = z.object({ code: scalar, data: z.unknown().optional(), message:z.string().nullish() });
const jobSchema = z.object({ id: scalar, jobTitle: z.string(), citiesStr: z.string().nullish(), salaryRangeShort: z.string().nullish(), minSalaryLabel: scalar.nullish(), maxSalaryLabel: scalar.nullish(), state: scalar.nullish() });
export function isZhilianDomain(domain: string): boolean { return domain.replace(/^\./, '') === 'zhaopin.com' || domain.endsWith('.zhaopin.com'); }
export function readEnvelope(value: unknown): unknown {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) throw new ConnectorError('format', '智联返回格式发生变化，请稍后重试。');
  if (String(parsed.data.code) === '401') throw new ConnectorError('expired', '智联登录已失效，请重新连接账号。');
  if (String(parsed.data.code) !== '200') {
    const businessCode=String(parsed.data.code);
    const label=/^[A-Za-z_0-9-]{1,40}$/.test(businessCode)?`（业务码 ${businessCode}）`:'';
    const reason=(parsed.data.message??'').replace(/https?:\/\/\S+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[A-Za-z0-9_=-]{24,}|\d{7,}/g,'[已隐藏]').slice(0,200);
    throw new ConnectorError('platform', `智联暂未允许此次读取${label}${reason?`：${reason}`:'，请在官方页面检查账号状态。'}`);
  }
  return parsed.data.data;
}
export function parseJobs(value: unknown, accountId: string): Job[] {
  const parsed = z.array(jobSchema).safeParse(readEnvelope(value));
  if (!parsed.success) throw new ConnectorError('format', '岗位数据格式发生变化，已停止同步。');
  return parsed.data.map(job => ({ id: accountId ? `${accountId}:${job.id}` : String(job.id), accountId, title: job.jobTitle, city: job.citiesStr || '未提供', salary: job.salaryRangeShort || [job.minSalaryLabel, job.maxSalaryLabel].filter(v => v != null).join('–') || '未提供', status: job.state == null ? '状态未提供' : `平台状态 ${job.state}` }));
}
