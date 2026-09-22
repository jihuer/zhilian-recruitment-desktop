import { expect, test } from 'bun:test';
import { attachmentUnavailableReason, inspectAttachmentUsing } from '../desktop/attachment-connector';

const input = { sessionId: 'session1', resumeNumber: 'resume1', resumeLanguage: '1', jobNumber: 'job1' };
const account = { isHrPilotUser: false };
const session = { ...input, sessionType: 'USER', lockSession: false, lockSessionScene: null };
const detail = { candidate: { state: 'PENDING' }, flags: { attachResumeButton: 'SHOW_ONLINE', inappropriateButton: 'SHOW' }, interestButton: { price: 0 } };
function driver(values: { account?: unknown; session?: unknown; detail?: unknown; url?: string } = {}) {
  const calls: { path: string; data?: Readonly<Record<string, unknown>> }[] = [];
  const read = async (path: string, data?: Readonly<Record<string, unknown>>) => {
    calls.push({ path, ...(data ? { data } : {}) });
    switch (path) {
      case '/api/session': return { code: 200, data: values.account ?? account };
      case '/api/im/session/list': return { code: 200, data: [values.session ?? session] };
      case '/api/resume/detail': return { code: 200, data: values.detail ?? detail };
      case '/api/resume/getAttachResumeInfo': return { code: 200, data: { url: values.url ?? 'https://files.example.test/original.pdf?grant=private' } };
      default: throw new TypeError('Unexpected endpoint');
    }
  };
  return { calls, read };
}
test('only gets attachment info after all explicit free-download gates pass', async () => {
  const probe = driver();
  const result = await inspectAttachmentUsing(probe.read, input);
  expect(result.status).toBe('ready');
  expect(probe.calls.map(call => call.path)).toEqual(['/api/session', '/api/im/session/list', '/api/resume/detail', '/api/resume/getAttachResumeInfo']);
  expect(probe.calls[3]?.data).toEqual({ resumeNumber: 'resume1', language: 1, jobNumber: 'job1' });
  expect(probe.calls[2]?.data).toMatchObject({ k: '', t: '', isOperator: 'rd', isPreFetch: false });
});
test('missing applicable account or permission metadata blocks without requesting an attachment', async () => {
  for (const values of [{ account: {} }, { session: { ...session, resumeNumber: undefined } }, { detail: { ...detail, candidate: {} } }, { detail: { ...detail, flags: {} } }]) {
    const probe = driver(values);
    expect((await inspectAttachmentUsing(probe.read, input)).status).toBe('blocked');
    expect(probe.calls.some(call => call.path.endsWith('getAttachResumeInfo'))).toBe(false);
  }
});
test('trial accounts short-circuit and ordinary unavailable cases never unlock or download', async () => {
  for (const values of [{ account: { isHrPilotUser: true }, session: { ...session, lockSession: true }, detail: { ...detail, interestButton: { price: 1 } } }, { detail: { ...detail, candidate: { state: 'INAPPROPRIATE' } } }, { detail: { ...detail, flags: { ...detail.flags, attachResumeButton: 'NO_REPLY_APPLY' } } }]) {
    const probe = driver(values);
    expect((await inspectAttachmentUsing(probe.read, input)).status).toBe('blocked');
    expect(probe.calls.some(call => call.path.endsWith('getAttachResumeInfo'))).toBe(false);
  }
});
test('stale resume references do not fetch detail or attachment', async () => {
  const probe = driver({ session: { ...session, resumeNumber: 'changed' } });
  expect((await inspectAttachmentUsing(probe.read, input)).status).toBe('blocked');
  expect(probe.calls).toHaveLength(2);
});
test('unsafe file URLs do not leave the connector', async () => {
  for (const url of ['http://files.example.test/f.pdf', 'https://name:secret@files.example.test/f.pdf', 'not a url']) {
    const probe = driver({ url });
    const result = await inspectAttachmentUsing(probe.read, input);
    expect(result.status).toBe('blocked');
    expect(JSON.stringify(result)).not.toContain(url);
  }
});

test('ordinary accounts do not mistake a contact price or trial-only flag for an attachment fee', async () => {
  const probe = driver({ session: { ...session, lockSession: true, lockSessionScene: 'EFFECT_POST_PAY' }, detail: { ...detail, interestButton: { price: 100 }, flags: { attachResumeButton: 'SHOW_ONLINE', inappropriateButton: 'INAPPROPRIATE' } } });
  expect((await inspectAttachmentUsing(probe.read, input)).status).toBe('ready');
  expect(probe.calls.at(-1)?.path).toBe('/api/resume/getAttachResumeInfo');
});
test('ordinary accounts need no trial-only price or lock fields', async () => {
  const probe = driver({ session: { ...input, sessionType: 'USER' }, detail: { candidate: { state: 'PENDING' }, flags: { attachResumeButton: 'SHOW_ONLINE' } } });
  expect((await inspectAttachmentUsing(probe.read, input)).status).toBe('ready');
});
test('trial accounts stop before other requests even when prices are absent or zero', async () => {
  for (const price of [undefined, 0]) {
    const probe = driver({ account: { isHrPilotUser: true }, detail: { ...detail, interestButton: { price } } });
    expect((await inspectAttachmentUsing(probe.read, input)).status).toBe('blocked');
    expect(probe.calls.map(call => call.path)).toEqual(['/api/session']);
  }
});

test('explains observed attachment states without claiming absence', () => {
  const cases = [ ['HIDE', '隐藏了附件入口'], ['ASK_FOR_ATTACH_ON_DELETED', '已删除'], ['WAITING_FOR_REPLY', '等待对方发送'], ['GRAY_FOR_REPLY_TO_UNLOCK', '先回复对方'], ['GRAY_FOR_USER_REPLY_TO_UNLOCK', '对方先回复'], ['B_CHAT_WITHOUT_APPLY', '投递或发送附件'], ['NO_REPLY_APPLY', '回复或索要流程'] ];
  for (const pair of cases) {
    const [state, label] = pair;
    if (!state || !label) throw new TypeError('Invalid test case');
    expect(attachmentUnavailableReason(state)).toContain(label);
  }
  expect(attachmentUnavailableReason('NEW_PLATFORM_STATE')).toContain('NEW_PLATFORM_STATE');
  expect(attachmentUnavailableReason('private@example.com')).not.toContain('private@example.com');
  expect(attachmentUnavailableReason('NEW_PLATFORM_STATE')).toContain('不能据此判断附件不存在');
});
