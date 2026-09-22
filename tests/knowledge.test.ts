import { expect, test } from 'bun:test';
import { retrieveKnowledge } from '../desktop/knowledge';
import { KnowledgeDocumentSchema, type KnowledgeDocument } from '../shared/knowledge';

const company: KnowledgeDocument = { id: 'company', title: '公司福利', scope: 'company', accountId: 'a', jobId: '', text: '员工入职缴纳五险一金，提供带薪年假。', updatedAt: '' };
const job: KnowledgeDocument = { id: 'job', title: '销售岗位', scope: 'job', accountId: 'a', jobId: 'sales', text: '销售岗位试用期三个月，底薪六千元。', updatedAt: '' };
const query = { accountId: 'a', jobId: 'sales', query: '销售试用期多长？' };

test('retrieves relevant Chinese job and shared company facts', () => {
  expect(retrieveKnowledge([company, job], query)[0]?.documentId).toBe('job');
  expect(retrieveKnowledge([company, job], { ...query, query: '有五险一金吗' })[0]?.documentId).toBe('company');
});
test('returns no result for unrelated or empty questions', () => {
  expect(retrieveKnowledge([company, job], { ...query, query: '火星天气' })).toEqual([]);
  expect(retrieveKnowledge([company, job], { ...query, query: ' ？！' })).toEqual([]);
});
test('isolates different accounts and jobs before retrieval', () => {
  const otherCompany = { ...company, id: 'other', accountId: 'b' };
  const otherJob = { ...job, id: 'engineering', jobId: 'engineer' };
  expect(retrieveKnowledge([otherCompany, otherJob], { ...query, query: '五险一金 销售' })).toEqual([]);
  expect(retrieveKnowledge([company], { ...query, accountId: '', query: '五险一金' })).toEqual([]);
  expect(retrieveKnowledge([job], { ...query, jobId: '' })).toEqual([]);
});
test('bounds selected chunk count and total text', () => {
  const documents = Array.from({ length: 12 }, (_, index) => ({ ...job, id: String(index), text: '销售底薪六千元。'.repeat(1000) }));
  const hits = retrieveKnowledge(documents, query);
  expect(hits.length).toBe(6);
  expect(hits.every(hit => hit.text.length <= 800)).toBe(true);
  expect(hits.reduce((total, hit) => total + hit.text.length, 0)).toBeLessThanOrEqual(4800);
});
test('retrieves current edits without stale index and excludes deleted documents', () => {
  expect(retrieveKnowledge([{ ...job, text: '底薪八千元。' }], { ...query, query: '底薪' })[0]?.text).toBe('底薪八千元。');
  expect(retrieveKnowledge([], query)).toEqual([]);
});
test('validates document scope, required content and size at input boundary', () => {
  expect(KnowledgeDocumentSchema.safeParse(company).success).toBe(true);
  expect(KnowledgeDocumentSchema.safeParse({ ...company, jobId: 'sales' }).success).toBe(false);
  expect(KnowledgeDocumentSchema.safeParse({ ...job, jobId: '' }).success).toBe(false);
  expect(KnowledgeDocumentSchema.safeParse({ ...job, text: ' '.repeat(10) }).success).toBe(false);
  expect(KnowledgeDocumentSchema.safeParse({ ...job, text: '中'.repeat(100001) }).success).toBe(false);
});
