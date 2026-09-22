import { expect, test } from 'bun:test';
import { LocalModelManager } from '../desktop/local-models';
import { response, trustedDownload } from '../desktop/model-download';
import type { LocalModelStatus } from '../shared/local-models';

test('rejects unlisted model before writing files or contacting a registry', async () => {
  const states: LocalModelStatus[] = [];
  const manager = new LocalModelManager('/path-must-not-be-created', state => states.push(state));
  await expect(manager.install('../../arbitrary-model')).rejects.toThrow('请选择支持的本地模型');
  expect(states).toHaveLength(0);
});
test('closed manager cannot start an external process', async () => {
  const manager = new LocalModelManager('/path-must-not-be-created', () => undefined);
  manager.close();
  await expect(manager.ensureRunning()).rejects.toThrow('程序正在关闭');
  await expect(manager.install('qwen2.5:0.5b')).rejects.toThrow('程序正在关闭');
});
test('official redirect allowlist refuses downgrade, credentials and lookalike hosts', () => {
  expect(trustedDownload(new URL('https://release-assets.githubusercontent.com/file'))).toBe(true);
  for (const url of ['http://github.com/a', 'https://github.com.evil.test/a', 'https://github.com:8443/a', 'https://user:secret@github.com/a', 'https://127.0.0.1/a']) {
    expect(trustedDownload(new URL(url))).toBe(false);
  }
});
test('local API request refuses remote host before network access', async () => {
  await expect(response(new URL('https://example.com/api/pull'), { signal: new AbortController().signal })).rejects.toThrow('地址不受信任');
});
test('cancelled installation publishes idle and performs no download', async () => {
  const states: LocalModelStatus[] = [];
  const manager = new LocalModelManager('/path-must-not-be-created', state => {
    states.push(state);
    if (state.phase === 'installing') manager.cancel();
  });
  await expect(manager.install('qwen2.5:0.5b')).rejects.toThrow();
  expect(states.at(-1)?.phase).toBe('idle');
  expect(states.at(-1)?.message).toContain('已取消');
});
