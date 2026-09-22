import { z } from 'zod';
import { ConnectorError } from './connector-data';

const label = z.string().max(2000).nullish();
const workSchema = z.object({ orgName: label, jobTitle: label });
const educationSchema = z.object({ schoolName: label, major: label, educationTimeLabel: label });
const resumeSchema = z.object({
  user: z.object({ careerStateLabel: label, maxEducationLabel: label, workYearsLabel: label }).nullish(),
  resume: z.object({ workExperiences: z.array(workSchema).max(100).nullish(), educationExperiences: z.array(educationSchema).max(100).nullish() }).nullish(),
  preferredCity: label,
  preferredJobType: label,
});

export function parseResume(value: unknown): string {
  const parsed = resumeSchema.safeParse(value);
  if (!parsed.success) throw new ConnectorError('format', '在线简历字段格式发生变化，已停止读取。');
  const data = parsed.data;
  const labels = [data.user?.careerStateLabel, data.user?.maxEducationLabel, data.user?.workYearsLabel, data.preferredCity, data.preferredJobType];
  const work = (data.resume?.workExperiences ?? []).map(item => [item.orgName, item.jobTitle].filter((field): field is string => typeof field === 'string' && field.trim().length > 0).join(' · '));
  const education = (data.resume?.educationExperiences ?? []).map(item => [item.schoolName, item.major, item.educationTimeLabel].filter((field): field is string => typeof field === 'string' && field.trim().length > 0).join(' · '));
  if (![...labels, ...work, ...education].some(item => typeof item === 'string' && item.trim().length > 0)) throw new ConnectorError('format', '当前在线简历未返回可展示的职业资料，请在智联检查访问权限。');
  const shown = (item: string | null | undefined) => item?.trim() || '未提供';
  const lines = [
    '在线简历摘要（仅展示本次返回的职业资料）',
    `职业状态：${shown(data.user?.careerStateLabel)}`,
    `学历：${shown(data.user?.maxEducationLabel)}`,
    `工作年限：${shown(data.user?.workYearsLabel)}`,
    `意向城市：${shown(data.preferredCity)}`,
    `意向岗位：${shown(data.preferredJobType)}`,
    '', '工作经历：',
    ...(work.length ? work.map((item, index) => `${index + 1}. ${item || '该条经历的单位与岗位未提供'}`) : ['未提供']),
    '', '教育经历：',
    ...(education.length ? education.map((item, index) => `${index + 1}. ${item || '该条经历的学校、专业与时间未提供'}`) : ['未提供']),
    '', '此摘要不代表完整简历，未包含其他字段与附件。',
  ];
  const text = lines.join('\n');
  return text.length <= 20000 ? text : `${text.slice(0, 19940)}\n【内容较长，摘要已截断；不代表完整简历】`;
}

export function describeResumeShape(value: unknown): string {
  let remaining = 100;
  function shape(input: unknown, depth: number): unknown {
    if (remaining-- <= 0) return { type: 'truncated' };
    if (input === null) return { type: 'null' };
    if (Array.isArray(input)) return { type: 'array', length: input.length, ...(depth < 3 && input.length > 0 ? { item: shape(input[0], depth + 1) } : {}) };
    if (typeof input !== 'object') return { type: typeof input };
    if (depth >= 3) return { type: 'object' };
    const parsed = z.record(z.string(), z.unknown()).safeParse(input);
    if (!parsed.success) return { type: 'object' };
    const fields: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(parsed.data).slice(0, 40)) {
      if (/^[A-Za-z_$][A-Za-z0-9_$]{0,59}$/.test(key)) fields[key] = shape(child, depth + 1);
    }
    return { type: 'object', fields };
  }
  return JSON.stringify(shape(value, 0)).slice(0, 4000);
}
