import { expect, test } from 'bun:test';
import { describeResumeShape, parseResume } from '../desktop/resume-data';

test('renders only verified professional labels and known experience fields', () => {
  const input = { user: { name: 'PRIVATE_NAME', phone: '13812345678', age: 999, genderLabel: 'PRIVATE_GENDER', nationality: 777, careerStateLabel: '在职', maxEducationLabel: '本科', workYearsLabel: '5年' }, resume: { workExperiences: [{ orgName: '示例科技', jobTitle: '客服主管', secret: 'PRIVATE_EXTRA' }], educationExperiences: [{ schoolName: '示例大学', major: '管理', educationTimeLabel: '2015—2019' }], purposes: [{ phone: 'PRIVATE_PHONE' }] }, preferredCity: '北京', preferredJobType: '客户服务', token: 'PRIVATE_TOKEN' };
  const text = parseResume(input);
  for (const included of ['职业状态：在职', '学历：本科', '工作年限：5年', '意向城市：北京', '意向岗位：客户服务', '示例科技 · 客服主管', '示例大学 · 管理 · 2015—2019']) expect(text).toContain(included);
  for (const excluded of ['PRIVATE_', '13812345678', '999', '777', 'phone', 'token']) expect(text).not.toContain(excluded);
});
test('shows missing blocks explicitly without inventing a complete resume', () => {
  const text = parseResume({ user: { workYearsLabel: '3年' } });
  expect(text).toContain('职业状态：未提供');
  expect(text).toContain('工作经历：\n未提供');
  expect(text).toContain('教育经历：\n未提供');
  expect(text).toContain('不代表完整简历');
});
test('does not report success for empty or malformed permitted data', () => {
  expect(() => parseResume({ user: { phone: 'secret' }, resume: {} })).toThrow('未返回可展示');
  expect(() => parseResume({ user: { workYearsLabel: '3年' }, resume: { workExperiences: [{ orgName: {} }] } })).toThrow('格式发生变化');
  expect(() => parseResume(null)).toThrow();
});
test('limits long output and labels truncation', () => {
  const text = parseResume({ resume: { workExperiences: Array.from({ length: 100 }, () => ({ orgName: 'x'.repeat(2000) })) } });
  expect(text.length).toBeLessThanOrEqual(20000);
  expect(text).toContain('摘要已截断');
});

test('offline shape helper remains value-free and bounded', () => {
  const shape = describeResumeShape({ phone: 'PRIVATE_VALUE', rows: [{ label: 'PRIVATE_NAME' }] });
  expect(shape).not.toContain('PRIVATE_');
  expect(shape).toContain('"length":1');
  expect(shape.length).toBeLessThanOrEqual(4000);
});
