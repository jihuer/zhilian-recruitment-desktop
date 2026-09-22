import { expect, test } from 'bun:test';
import { parseConversationSummaries } from '../desktop/conversation-data';

test('maps USER list summary without treating SDK msg as HTTP history', () => {
  const input = { code: 200, data: [{ sessionType: 'USER', sessionId: 21, name: '示例候选人', jobTitle: '客服', unreadCount: '2', lastSentence: JSON.stringify({ text: '请介绍岗位', sendTime: 1700000000000, senderId: 5 }), msg: { text: 'not the summary' } }] };
  expect(parseConversationSummaries(input, 'a')).toEqual([{ id: 'a:session:21', platformSessionId: '21', name: '示例候选人', message: '请介绍岗位', unreadCount: 2, platformJobTitle: '客服', platformUpdatedAt: '2023-11-14T22:13:20.000Z' }]);
});
test('deduplicates sessions and excludes system and staff entries', () => {
  const input = { code: '200', data: [{ sessionType: 'STAFF' }, { sessionType: 'OFFICIAL' }, { sessionType: 'USER', sessionId: '1' }, { sessionType: 'USER', sessionId: '1' }] };
  expect(parseConversationSummaries(input, 'a')).toHaveLength(1);
});
test('does not hide unauthorized or malformed data behind an empty list', () => {
  expect(() => parseConversationSummaries({ code: 401, data: null }, 'a')).toThrow('登录已失效');
  expect(() => parseConversationSummaries({ code: 500, data: [] }, 'a')).toThrow();
  expect(() => parseConversationSummaries({ code: 200, data: {} }, 'a')).toThrow();
  expect(() => parseConversationSummaries({ code: 200, data: [{ sessionType: 'USER' }] }, 'a')).toThrow();
  expect(() => parseConversationSummaries({ code: 200, data: [null] }, 'a')).toThrow();
});
test('malformed lastSentence yields a safe label without raw content', () => {
  const input = { code: 200, data: [{ sessionType: 'USER', sessionId: '1', lastSentence: '{private malformed text' }] };
  expect(parseConversationSummaries(input, 'a')[0]?.message).toBe('摘要暂不可解析');
});
test('valid empty list succeeds and missing summary stays empty', () => {
  expect(parseConversationSummaries({ code: 200, data: [] }, 'a')).toEqual([]);
  const result = parseConversationSummaries({ code: 200, data: [{ sessionType: 'USER', sessionId: '1', lastSentence: '{}' }] }, 'a');
  expect(result[0]?.message).toBe('');
  expect(result[0]?.platformUpdatedAt).toBe('');
});

test('preserves the observed USER target id separately from session identity', () => {
  const rows = [{ sessionType: 'USER', sessionId: 'session-1', userId: 42 }];
  const result = parseConversationSummaries({ code: 200, data: rows }, 'a');
  expect(result[0]?.platformUserId).toBe('42');
  expect(result[0]?.platformSessionId).toBe('session-1');
});

test('keeps documented resume locators without inventing resume content', () => {
  const rows = [{sessionType:'USER',sessionId:'s1',resumeNumber:'R-example',resumeLanguage:1,jobNumber:'J-example'}];
  expect(parseConversationSummaries({code:200,data:rows},'a')[0]).toMatchObject({platformResumeNumber:'R-example',platformResumeLanguage:'1',platformJobNumber:'J-example'});
  expect(parseConversationSummaries({code:200,data:[{sessionType:'USER',sessionId:'s2'}]},'a')[0]).not.toHaveProperty('platformResumeNumber');
});
