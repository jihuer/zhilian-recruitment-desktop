import { expect, test } from 'bun:test';
import { parseHistory } from '../desktop/history-data';

const text = { idServer: 'server-1', type: 'text', text: '岗位在哪里？', time: 1700000000000, from: 'candidate-1' };
test('maps text history from the documented data.messages envelope', () => {
  expect(parseHistory({ code: 200, data: { messages: [text] } })).toEqual([{ id: 'server-1', text: '岗位在哪里？', at: '2023-11-14T22:13:20.000Z', senderId: 'candidate-1', kind: 'text' }]);
});
test('deduplicates known identifiers and sorts by message time', () => {
  const rows = [{ ...text, idServer: 'later', time: 1700000001000 }, text, text, { ...text, idServer: null, sendMessageId: 'fallback', time: 1699999999000 }];
  expect(parseHistory({ code: 200, data: { messages: rows } }).map(item => item.id)).toEqual(['fallback', 'server-1', 'later']);
});
test('renders custom types as placeholders without returning raw JSON', () => {
  const rows = [{ ...text, type: 'custom', text: '{private payload}', content: '{secret card}' }];
  const result = parseHistory({ code: 200, data: { messages: rows } });
  expect(result[0]?.text).toBe('【卡片消息，请在智联查看】');
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(JSON.stringify(result)).not.toContain('private');
});
test('does not disguise expired or malformed history as an empty result', () => {
  expect(() => parseHistory({ code: 401 })).toThrow('登录已失效');
  expect(() => parseHistory({ code: 200, data: {} })).toThrow();
  expect(() => parseHistory({ code: 200, data: { messages: [{ ...text, time: 'not-a-time' }] } })).toThrow();
  expect(() => parseHistory({ code: 200, data: { messages: [{ ...text, text: null }] } })).toThrow();
  expect(parseHistory({ code: 200, data: { messages: [] } })).toEqual([]);
});

test('history connector rejects invalid targets and cursors before any HTTP context', async () => {
  const { ZhilianConnector } = await import('../desktop/connector');
  const connector = new ZhilianConnector();
  const targetResult = connector.readHistory('{}', '').catch((error: unknown) => error);
  const cursorResult = connector.readHistory('{}', '42', -1).catch((error: unknown) => error);
  expect(await targetResult).toMatchObject({ code: 'format' });
  expect(await cursorResult).toMatchObject({ code: 'format' });
  await connector.dispose();
});
test('identity and history reject after disposal without private API requests', async () => {
  const { ZhilianConnector } = await import('../desktop/connector');
  const connector = new ZhilianConnector();
  await connector.dispose();
  const history = connector.readHistory('{}', '42').catch((error: unknown) => error);
  const identity = connector.readIdentity('{}').catch((error: unknown) => error);
  expect(await history).toMatchObject({ code: 'cancelled' });
  expect(await identity).toMatchObject({ code: 'cancelled' });
});
