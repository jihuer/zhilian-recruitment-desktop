import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { access, mkdir, mkdtemp, rename, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Open } from 'unzipper';
import { z } from 'zod';
import { LOCAL_MODELS } from '../shared/local-models';
import type { LocalModelStatus } from '../shared/local-models';
import { downloadRuntime, LocalModelError, readJson, response } from './model-download';

const releases = {
  darwin: { name: 'ollama-darwin.tgz', size: 158556483, sha256: 'f18fba83fb1eb415e143fb0c24372ebc4388fd7206f4927d4899932653e8c11d' },
  x64: { name: 'ollama-windows-amd64.zip', size: 1465014498, sha256: '428c94622a04764b318ddf13a061898edf69e32ffa896f638ed6015fd3f33288' },
  arm64: { name: 'ollama-windows-arm64.zip', size: 208132291, sha256: '9ada3f4289f4b5475ec7d3646571b914120e32384dad7ab8bf847b39c1122675' },
} as const;
const PullSchema = z.object({ status: z.string().optional(), error: z.string().optional(), completed: z.number().optional(), total: z.number().optional() });
const TagsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });

export class LocalModelManager {
  private child: ChildProcess | undefined;
  private controller: AbortController | undefined;
  private starting: Promise<void> | undefined;
  private closed = false;
  constructor(private readonly directory: string, private readonly publish: (status: LocalModelStatus) => void) {}
  private get runtime() { return join(this.directory, 'runtime-0.34.1'); }
  private get executable() { return join(this.runtime, process.platform === 'win32' ? 'ollama.exe' : 'ollama'); }
  async install(model: string): Promise<void> {
    if (!LOCAL_MODELS.some(item => item.id === model)) throw new LocalModelError('请选择支持的本地模型');
    if (this.controller) throw new LocalModelError('已有本地模型安装任务');
    if (this.closed) throw new LocalModelError('程序正在关闭');
    const controller = new AbortController(); this.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60 * 60_000)]);
    let publishedAt = 0, highestProgress = 0;
    const update = (message: string, progress: number) => {
      if (Date.now() - publishedAt < 500) return;
      publishedAt = Date.now();
      highestProgress = Math.min(99, Math.max(highestProgress, progress));
      this.publish({ phase: 'installing', model, message, progress: highestProgress });
    };
    try {
      update('正在检查安装环境', 0);
      signal.throwIfAborted();
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const installed = await access(this.executable).then(() => true, () => false);
      if (installed) {
        signal.throwIfAborted();
        await this.ensureRunning();
        const tags = TagsSchema.parse(await readJson(signal));
        if (tags.models.some(item => item.name === model)) {
          this.publish({ phase: 'ready', model, message: '本地模型已安装，可以测试连接', progress: 100 });
          return;
        }
      }
      const definition = LOCAL_MODELS.find(item => item.id === model);
      const disk = await statfs(this.directory);
      const required = (definition?.bytes ?? 0) + (installed ? 200_000_000 : process.platform === 'win32' ? 5_000_000_000 : 650_000_000);
      if (disk.bavail * disk.bsize < required) throw new LocalModelError(`可用磁盘空间不足，至少需要 ${(required / 1e9).toFixed(1)} GB`);
      await this.installRuntime(signal, value => update('正在下载并校验本地模型引擎', value * 0.2));
      signal.throwIfAborted(); await this.ensureRunning(); signal.throwIfAborted();
      update('正在下载模型，首次下载可能需要几分钟', 20);
      await this.pull(model, signal, update);
      const tags = TagsSchema.parse(await readJson(signal));
      if (!tags.models.some(item => item.name === model)) throw new LocalModelError('模型下载后未出现在本地列表');
      this.publish({ phase: 'ready', model, message: '本地模型已安装，可以测试连接', progress: 100 });
    } catch (error) {
      this.publish({ phase: controller.signal.aborted ? 'idle' : 'error', model, progress: 0,
        message: controller.signal.aborted ? '已取消下载，可以重新开始' : error instanceof Error ? error.message : '本地模型安装失败' });
      throw error;
    } finally { this.controller = undefined; }
  }
  private async installRuntime(signal: AbortSignal, progress: (value: number) => void): Promise<void> {
    if (await access(this.executable).then(() => true, () => false)) return;
    const release = process.platform === 'darwin' ? releases.darwin : process.platform === 'win32' && (process.arch === 'x64' || process.arch === 'arm64') ? releases[process.arch] : undefined;
    if (!release) throw new LocalModelError('当前系统不支持一键安装，请使用在线模型');
    const temp = await mkdtemp(join(this.directory, 'install-'));
    try {
      const archive = join(temp, release.name), unpacked = join(temp, 'runtime');
      await downloadRuntime({ ...release, file: archive, url: `https://github.com/ollama/ollama/releases/download/v0.34.1/${release.name}` }, signal, progress);
      await mkdir(unpacked); signal.throwIfAborted();
      if (process.platform === 'darwin') {
        await new Promise<void>((resolve, reject) => {
          const child = spawn('/usr/bin/tar', ['-xzf', archive, '-C', unpacked], { signal, stdio: 'ignore' });
          child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new LocalModelError('模型引擎解压失败')));
        });
      } else {
        const zip = await Open.file(archive);
        if (zip.files.some(file => file.path.startsWith('/') || file.path.includes('..') || file.path.includes('\\'))) throw new LocalModelError('安装包路径不安全');
        await zip.extract({ path: unpacked, concurrency: 2 });
      }
      signal.throwIfAborted();
      await access(join(unpacked, process.platform === 'win32' ? 'ollama.exe' : 'ollama'));
      await rename(unpacked, this.runtime);
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  async ensureRunning(): Promise<void> {
    if (this.closed) throw new LocalModelError('程序正在关闭');
    if (this.starting) return this.starting;
    if (this.child?.killed && this.child.exitCode === null) {
      const ending = this.child;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { ending.kill('SIGKILL'); reject(new LocalModelError('本地引擎仍在退出，请稍后重试')); }, 5000);
        ending.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      await readJson(AbortSignal.timeout(5000)); return;
    }
    this.starting = this.start();
    try { await this.starting; } finally { this.starting = undefined; }
  }
  private async start(): Promise<void> {
    await access(this.executable).catch(() => { throw new LocalModelError('请先一键安装本地模型'); });
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once('error', () => reject(new LocalModelError('本地模型端口 11435 已被占用，请关闭占用程序')));
      server.listen(11435, '127.0.0.1', () => server.close(() => resolve()));
    });
    if (this.closed) throw new LocalModelError('程序正在关闭');
    const child = spawn(this.executable, ['serve'], { stdio: 'ignore', windowsHide: true, cwd: this.runtime,
      env: { PATH: process.env['PATH'] ?? '', HOME: this.directory, USERPROFILE: this.directory,
        TMPDIR: process.env['TMPDIR'] ?? this.directory, TEMP: process.env['TEMP'] ?? this.directory,
        SystemRoot: process.env['SystemRoot'] ?? '', OLLAMA_HOST: '127.0.0.1:11435',
        OLLAMA_MODELS: join(this.directory, 'models'), OLLAMA_NO_CLOUD: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_NUM_PARALLEL: '1' } });
    this.child = child;
    let failure: Error | undefined;
    child.once('error', error => { failure = error; });
    child.once('exit', () => { if (this.child === child) this.child = undefined; });
    for (let attempt = 0; attempt < 60; attempt++) {
      if (failure || child.exitCode !== null || child.killed || this.closed) throw failure ?? new LocalModelError('本地模型引擎未能启动');
      const ready = await readJson(AbortSignal.timeout(1000)).then(() => true, () => false);
      if (ready) return;
      await delay(500);
    }
    child.kill(); throw new LocalModelError('本地模型引擎启动超时');
  }
  private async pull(model: string, signal: AbortSignal, update: (message: string, progress: number) => void): Promise<void> {
    const res = await response(new URL('http://127.0.0.1:11435/api/pull'), { signal, body: JSON.stringify({ model, stream: true }) });
    let pending = '', success = false;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const item = PullSchema.parse(JSON.parse(line));
      if (item.error) throw new LocalModelError(item.error);
      if (item.status === 'success') success = true;
      update(item.total ? '正在下载模型文件' : '正在校验和安装模型', item.total ? 20 + Math.min(1, (item.completed ?? 0) / item.total) * 79 : 99);
    };
    try {
      for await (const value of res) {
        pending += String(value);
        if (pending.length > 1_000_000) throw new LocalModelError('模型下载响应过大');
        const lines = pending.split('\n'); pending = lines.pop() ?? '';
        for (const line of lines) consume(line);
      }
      consume(pending);
      if (!success) throw new LocalModelError('模型下载未完成，请重试');
    } finally { res.destroy(); }
  }
  cancel(): void { if (this.controller) { this.controller.abort(); this.child?.kill(); } }
  close(): void { this.closed = true; this.cancel(); this.child?.kill(); }
}
