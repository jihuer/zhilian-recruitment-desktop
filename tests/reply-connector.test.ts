import { expect, test } from 'bun:test';
import { checkReplyPermissionUsing, sendReplyUsing, ReplyUncertainError } from '../desktop/reply-connector';
import type { ReplyTransport } from '../desktop/reply-connector';

const target = { sessionId: 's1', resumeNumber: 'r1', resumeLanguage: '1', jobNumber: 'j1' };
const input = { target, content: ' 您好，工作地点在北京。 ', sendMessageId: 'a'.repeat(32) };
const session = { ...target, sessionType: 'USER', referType: 'CHAT', exclusiveCompany: false, silence: false, closed: false, mute: false, blocking: false };
function fixture(options: { account?: unknown; selected?: unknown; sessionDetail?: unknown; detail?: unknown; send?: ReplyTransport['send']; afterDetail?: () => void } = {}) {
  const calls: string[] = [];
  const messages: unknown[] = [];
  const reads: { path: string; data: unknown }[] = [];
  const transport: ReplyTransport = {
    read: async (path, data) => {
      calls.push(path); reads.push({ path, data });
      switch (path) {
        case '/api/session': return { code: 200, data: options.account ?? { inNewRegisterFlow: false, isHrPilotUser: false } };
        case '/api/im/session/list': return { code: 200, data: [options.selected ?? session] };
        case '/api/im/session/detail': return { code: 200, data: options.sessionDetail ?? options.selected ?? session };
        case '/api/resume/detail': options.afterDetail?.(); return { code: 200, data: options.detail ?? { candidate: { sourceType: 'YOULIAO' } } };
      }
    },
    send: async data => { calls.push('SEND'); messages.push(data); return options.send ? options.send(data) : { status: 200, body: { code: 200 } }; },
  };
  return { transport, calls, messages, reads };
}
test('freshly checks ordinary permission then sends exactly one fixed text body', async () => {
  const f = fixture();
  await sendReplyUsing(f.transport, input, () => true);
  expect(f.calls).toEqual(['/api/session', '/api/im/session/list', '/api/im/session/detail', '/api/resume/detail', 'SEND']);
  expect(f.messages).toEqual([{ content: '您好，工作地点在北京。', sessionId: 's1', sendMessageId: 'a'.repeat(32) }]);
});
test('check mode never sends and does not require irrelevant pilot price or lock fields', async () => {
  const f = fixture();
  expect((await checkReplyPermissionUsing(f.transport, target)).allowed).toBe(true);
  expect(f.messages).toHaveLength(0);
});
test('stopping during the final read prevents POST at the last synchronous check', async () => {
  let enabled = true;
  const f = fixture({ afterDetail: () => { enabled = false; } });
  const result = await sendReplyUsing(f.transport, input, () => enabled).catch((error: unknown) => error);
  expect(result).toMatchObject({ code: 'cancelled' });
  expect(f.messages).toHaveLength(0);
});
test('unknown fee, registration, mute, blocking and target mismatch prevent sending', async () => {
  for (const options of [{ account: {} }, { account: { inNewRegisterFlow: true, isHrPilotUser: false } }, { account: { inNewRegisterFlow: false, isHrPilotUser: true } }, { selected: { ...session, mute: true } }, { selected: { ...session, blocking: true } }, { selected: { ...session, exclusiveCompany: undefined } }, { selected: { ...session, resumeNumber: 'changed' } }]) {
    const f = fixture(options);
    const result = await sendReplyUsing(f.transport, input, () => true).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Error);
    expect(f.messages).toHaveLength(0);
  }
});
test('applies only the relevant lock and refusal branches', async () => {
  for (const options of [{ selected: { ...session, referType: 'BATCH_APPLY', lockSession: true } }, { selected: { ...session, referType: 'STAFF_DIRECT_RECOMMEND' } }, { detail: { candidate: { sourceType: 'YUELIAO' } }, selected: { ...session, status: 'REJECTED' } }]) {
    const f = fixture(options);
    expect((await checkReplyPermissionUsing(f.transport, target)).allowed).toBe(false);
    expect(f.messages).toHaveLength(0);
  }
});
test('transport failure or malformed acknowledgement is uncertain and never retried', async () => {
  for (const send of [async () => { throw new TypeError('network disconnected'); }, async () => ({ status: 200, body: '<html>error</html>' }), async () => ({ status: 502, body: {} })]) {
    const f = fixture({ send });
    const result = await sendReplyUsing(f.transport, input, () => true).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(ReplyUncertainError);
    expect(f.messages).toHaveLength(1);
  }
});
test('business refusals are explicit and are not retried', async () => {
  for (const code of [800003, 800004]) {
    const f = fixture({ send: async () => ({ status: 200, body: { code } }) });
    const result = await sendReplyUsing(f.transport, input, () => true).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: 'platform' });
    expect(result).not.toBeInstanceOf(ReplyUncertainError);
    expect(f.messages).toHaveLength(1);
  }
});
test('invalid message ID and empty content do not even perform permission reads', async () => {
  for (const invalid of [{ ...input, sendMessageId: 'invalid' }, { ...input, content: ' ' }]) {
    const f = fixture();
    await sendReplyUsing(f.transport, invalid, () => true).catch((error: unknown) => { expect(error).toMatchObject({ code: 'format' }); });
    expect(f.calls).toHaveLength(0);
  }
});

test('missing permission diagnostics show schema field names without raw values', async () => {
  const f = fixture({ selected: { ...session, exclusiveCompany: 'PRIVATE_INVALID_VALUE', mute: undefined } });
  const result = await checkReplyPermissionUsing(f.transport, target);
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain('exclusiveCompany');
  expect(result.reason).toContain('mute');
  expect(result.reason).not.toContain('PRIVATE_INVALID_VALUE');
});

test('fresh read-only details fill missing list permission fields without marking read', async () => {
  const f = fixture({ selected: { ...target, sessionType: 'USER', referType: 'CHAT' }, sessionDetail: session });
  expect((await checkReplyPermissionUsing(f.transport, target)).allowed).toBe(true);
  expect(f.reads.find(read => read.path === '/api/im/session/detail')?.data).toEqual({ sessionId: 's1', isCampusWidget: false, markRead: false, includeResumeDetail: true });
  expect(f.messages).toHaveLength(0);
  expect(f.calls).toHaveLength(4);
});
test('changed detail session identity or resume locator blocks sending', async () => {
  for (const sessionDetail of [{ ...session, sessionId: 'someone-else' }, { ...session, resumeNumber: 'changed' }]) {
    const f = fixture({ sessionDetail });
    expect((await checkReplyPermissionUsing(f.transport, target)).allowed).toBe(false);
    expect(f.messages).toHaveLength(0);
  }
});
test('fresh detail cannot override the original list referType to avoid its lock gate', async () => {
  const f = fixture({ selected: { ...session, referType: 'BATCH_APPLY' }, sessionDetail: { ...session, referType: 'CHAT', lockSession: true } });
  expect((await checkReplyPermissionUsing(f.transport, target)).allowed).toBe(false);
  expect(f.messages).toHaveLength(0);
});
