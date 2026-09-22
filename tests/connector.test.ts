import { expect, test } from 'bun:test';
import { ConnectorError, parseJobs, querySchema, sessionSchema } from '../desktop/connector-data';
import { ZhilianConnector } from '../desktop/connector';

test('maps observed recruiter fields and isolates job IDs by account', () => {
  const envelope = { code: 200, data: [{ id: 42, jobTitle: '招聘专员', citiesStr: '北京', salaryRangeShort: '8千-1万', state: 1 }] };
  const jobs = parseJobs(envelope, 'account-a');
  expect(jobs).toEqual([{ id: 'account-a:42', accountId: 'account-a', title: '招聘专员', city: '北京', salary: '8千-1万', status: '平台状态 1' }]);
});
test('treats business 401 as expired rather than an empty successful list', () => {
  expect(() => parseJobs({ code: 401, data: null }, 'a')).toThrow(ConnectorError);
  try { parseJobs({ code: '401', data: null }, 'a'); } catch (error) { expect(error instanceof ConnectorError && error.code).toBe('expired'); }
});
test('rejects changed shape rather than silently losing jobs', () => {
  expect(() => parseJobs({ code: 200, data: [{ id: 42 }] }, 'a')).toThrow(ConnectorError);
});
test('only accepts the reviewed query fields', () => {
  expect(querySchema.safeParse({ activeJobNumber: '', includingHotJob: true }).success).toBe(true);
  expect(querySchema.safeParse({ candidateIds: ['42'], send: true }).success).toBe(false);
});
test('rejects cookies outside Zhilian', () => {
  const cookies = [{ name: 'session', value: 'test', domain: 'zhaopin.com.attacker.test', path: '/', expires: -1, secure: true, httpOnly: true, sameSite: 'Lax' }];
  expect(sessionSchema.safeParse({ version: 1, cookies, query: {} }).success).toBe(false);
});
test('cancels before Chrome launch and can dispose repeatedly', async () => {
  const connector = new ZhilianConnector();
  const connecting = connector.connect({ chromePath: '/nonexistent/chrome', onPhase: () => {} });
  const rejection = connecting.then(() => 'unexpected success', (error: unknown) => error instanceof ConnectorError ? error.code : 'unexpected error');
  await connector.cancel();
  expect(await rejection).toBe('cancelled');
  await connector.dispose();
  await connector.dispose();
  await expect(connector.listJobs('{}', 'a')).rejects.toMatchObject({ code: 'cancelled' });
});
