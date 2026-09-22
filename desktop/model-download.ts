import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

export class LocalModelError extends TypeError {}
export function trustedDownload(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
    && ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname);
}
export async function response(url: URL, options: { signal: AbortSignal; body?: string; download?: boolean }, redirects = 0): Promise<IncomingMessage> {
  if (options.download ? !trustedDownload(url) : url.origin !== 'http://127.0.0.1:11435') throw new LocalModelError('下载或本地服务地址不受信任');
  const res = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      signal: options.signal, method: options.body === undefined ? 'GET' : 'POST',
      headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
    }, resolve);
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new LocalModelError('网络连接超时，请重试')));
    req.end(options.body);
  });
  if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && options.download && res.headers.location && redirects < 4) {
    res.resume();
    return response(new URL(res.headers.location, url), options, redirects + 1);
  }
  if (res.statusCode !== 200) { res.resume(); throw new LocalModelError(`服务返回 HTTP ${res.statusCode ?? '未知'}`); }
  return res;
}
export async function downloadRuntime(input: { url: string; file: string; sha256: string; size: number }, signal: AbortSignal, progress: (value: number) => void): Promise<void> {
  const res = await response(new URL(input.url), { signal, download: true });
  const handle = await open(input.file, 'wx', 0o600);
  const hash = createHash('sha256');
  let received = 0;
  try {
    for await (const value of res) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
      received += chunk.length;
      if (received > input.size) throw new LocalModelError('安装包超过预期大小');
      hash.update(chunk); await handle.writeFile(chunk); progress(received / input.size * 100);
    }
    if (received !== input.size || hash.digest('hex') !== input.sha256) throw new LocalModelError('安装包校验失败，未执行安装');
  } finally { res.destroy(); await handle.close(); }
}
export async function readJson(signal: AbortSignal): Promise<unknown> {
  const res = await response(new URL('http://127.0.0.1:11435/api/tags'), { signal });
  let text = '';
  try {
    for await (const value of res) { text += String(value); if (text.length > 2_000_000) throw new LocalModelError('本地响应过大'); }
    return JSON.parse(text);
  } finally { res.destroy(); }
}
