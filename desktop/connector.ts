import { checkReplyPermissionUsing, sendReplyUsing, replyTransport, ReplyUncertainError } from './reply-connector';
import type { ReplyTarget, ReplyInput, ReplyPermission } from './reply-connector';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, request } from 'playwright';
import type { APIRequestContext, BrowserContext, Response } from 'playwright';
import type { Job } from '../shared/contracts';
import { ConnectorError, envelopeSchema, isZhilianDomain, parseJobs, querySchema, readEnvelope, searchSchema, sessionSchema } from './connector-data';
import type { Session } from './connector-data';
import { parseConversationSummaries } from './conversation-data';
import type { ConversationSummary } from './conversation-data';
import { readMessagingStaffId,withMessageDirections } from './message-direction';
import { inspectAttachmentWithContext } from './attachment-connector';
import type { AttachmentInput, AttachmentResult } from './attachment-connector';
import { parseResume } from './resume-data';
import { parseHistory } from './history-data';
import type { HistoryMessage } from './history-data';
export { ConnectorError } from './connector-data';
const origin = 'https://rd6.zhaopin.com';
const jobsPath = '/api/talent/recommend/getJobList';
type ConnectOptions = { readonly chromePath: string; readonly onPhase: (phase: 'opening' | 'waiting' | 'verifying', message: string) => void };
type Connection = { session: string; jobs: Job[] };
function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw new ConnectorError('cancelled', '已取消连接。');
}
function observeLogin(browser: BrowserContext, signal: AbortSignal): { readonly result: Promise<Pick<Session, 'query' | 'search'>>; readonly stop: () => void } {
  let stop = () => {};
  const result = new Promise<Pick<Session, 'query' | 'search'>>((resolve, reject) => {
    let finished = false;
    const finish = (value: Pick<Session, 'query' | 'search'> | ConnectorError) => {
      if (finished) return;
      finished = true; stop();
      if (value instanceof ConnectorError) reject(value); else resolve(value);
    };
    const cancelled = () => finish(new ConnectorError('cancelled', '已取消连接。'));
    const closed = () => finish(new ConnectorError('browser', '登录窗口已关闭，请重新连接。'));
    const timer = setTimeout(() => finish(new ConnectorError('timeout', '登录等待超过 10 分钟，请重新连接。')), 600_000);
    const inspect = async (response: Response) => {
      const url = new URL(response.url());
      if (url.origin !== origin || url.pathname !== jobsPath || response.request().method() !== 'POST') return;
      try {
        const body: unknown = await response.json();
        const envelope = envelopeSchema.safeParse(body);
        if (!envelope.success || String(envelope.data.code) !== '200') return;
        parseJobs(body, '');
        const query = querySchema.safeParse(response.request().postDataJSON());
        if (!query.success) throw new ConnectorError('format', '岗位查询参数发生变化，已停止连接。');
        const search = searchSchema.safeParse(url.search);
        if (!search.success) throw new ConnectorError('format', '岗位查询包含未经审查的授权参数，已停止连接。');
        finish({ query: query.data, search: search.data });
      } catch (error) {
        finish(error instanceof ConnectorError ? error : new ConnectorError('format', '无法验证岗位响应，请重新连接。'));
      }
    };
    const listener = (response: Response) => { void inspect(response); };
    stop = () => { clearTimeout(timer); browser.off('response', listener); browser.off('close', closed); signal.removeEventListener('abort', cancelled); };
    browser.on('response', listener); browser.on('close', closed); signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) cancelled();
  });
  return { result, stop: () => stop() };
}
export class ZhilianConnector {
  private active: { readonly controller: AbortController; readonly done: Promise<Connection> } | undefined;
  private readonly requests = new Set<APIRequestContext>();
  private disposed = false;
  connect(options: ConnectOptions): Promise<Connection> {
    if (this.disposed) return Promise.reject(new ConnectorError('cancelled', '软件正在关闭。'));
    if (this.active) return Promise.reject(new ConnectorError('busy', '已有登录窗口，请先完成或取消。'));
    const controller = new AbortController();
    const done = this.performConnect(options, controller.signal).finally(() => { this.active = undefined; });
    this.active = { controller, done };
    return done;
  }
  async cancel(): Promise<void> {
    const active = this.active;
    if (!active) return;
    active.controller.abort();
    await Promise.allSettled([active.done]);
  }
  private async performConnect(options: ConnectOptions, signal: AbortSignal): Promise<Connection> {
    let browser: BrowserContext | undefined;
    let profile: string | undefined;
    let observation: ReturnType<typeof observeLogin> | undefined;
    try {
      options.onPhase('opening', '正在打开独立 Chrome 登录窗口…');
      profile = await mkdtemp(join(tmpdir(), 'zhilian-desktop-login-'));
      assertActive(signal);
      browser = await chromium.launchPersistentContext(profile, { ...(options.chromePath ? { executablePath: options.chromePath } : { channel: 'chrome' }), headless: false, chromiumSandbox: true, timeout: 30_000 });
      assertActive(signal);
      const page = browser.pages()[0] ?? await browser.newPage();
      observation = observeLogin(browser, signal);
      options.onPhase('waiting', '请在 Chrome 完成招聘者登录，并打开「推荐人才」页面；连接成功后窗口自动关闭。');
      const [observed] = await Promise.all([observation.result, page.goto(`${origin}/app/recommend`, { waitUntil: 'domcontentloaded', timeout: 45_000 })]);
      assertActive(signal);
      options.onPhase('verifying', '登录已检测到，正在关闭 Chrome 并验证独立读取…');
      const state = await browser.storageState();
      const session: Session = { version: 1, cookies: state.cookies.filter(cookie => isZhilianDomain(cookie.domain)), ...observed };
      await browser.close(); browser = undefined;
      await rm(profile, { recursive: true, force: true }); profile = undefined;
      assertActive(signal);
      const result = await this.readJobs(session, '', signal);
      assertActive(signal);
      return result;
    } catch (error) {
      if (signal.aborted) throw new ConnectorError('cancelled', '已取消连接。');
      if (error instanceof ConnectorError || error instanceof ReplyUncertainError) throw error;
      throw new ConnectorError('browser', '连接失败，请检查 Chrome 路径、网络及智联登录状态后重试。');
    } finally {
      observation?.stop();
      try { await browser?.close(); } finally { if (profile) await rm(profile, { recursive: true, force: true }); }
    }
  }
  async listJobs(serialized: string, accountId: string): Promise<Connection> {
    if (this.disposed) throw new ConnectorError('cancelled', '软件正在关闭。');
    let session: Session;
    try { session = sessionSchema.parse(JSON.parse(serialized)); }
    catch (error) { if (error instanceof Error) throw new ConnectorError('expired', '本地授权资料不可用，请重新连接账号。'); throw error; }
    return this.readJobs(session, accountId);
  }
  async listConversations(serialized: string, accountId: string): Promise<{ readonly conversations: ConversationSummary[]; readonly session: string }> {
    if (this.disposed) throw new ConnectorError('cancelled', '软件正在关闭。');
    let saved: Session;
    try { saved = sessionSchema.parse(JSON.parse(serialized)); }
    catch (error) { if (error instanceof Error) throw new ConnectorError('expired', '本地登录资料不可用，请重新连接。'); throw error; }
    const context = await request.newContext({ storageState: { cookies: saved.cookies, origins: [] }, timeout: 20_000, maxRedirects: 0 });
    this.requests.add(context);
    try {
      const response = await context.post(`${origin}/api/im/session/list`, { headers: { 'y-zp-business-type': 'B' }, data: { pageSize: 20, pageNo: 1, keyword: '', sessionType: '', states: [], groupSelectorVal: '', includeResume: true }, maxRedirects: 0 });
      try {
        if (response.status() === 401) throw new ConnectorError('expired', '智联登录已失效，请重新连接。');
        if (!response.ok()) throw new ConnectorError('platform', '会话摘要读取被拒绝，请在官方页面检查账号状态。');
        const conversations = parseConversationSummaries(await response.json(), accountId);
        const state = await context.storageState();
        return { conversations, session: JSON.stringify({ ...saved, cookies: state.cookies.filter(cookie => isZhilianDomain(cookie.domain)) }) };
      } finally { await response.dispose(); }
    } catch (error) {
      if (error instanceof ConnectorError || error instanceof ReplyUncertainError) throw error;
      throw new ConnectorError('platform', '会话摘要读取失败，请检查网络后重试。');
    } finally { this.requests.delete(context); await context.dispose(); }
  }
  async readHistory(serialized: string, targetId: string, endTime?: number, peerPartnerId?: string): Promise<{ readonly session: string; readonly messages: HistoryMessage[] }> {
    const input = z.object({ targetId: z.string().min(1).max(200), endTime: z.number().finite().positive().optional() }).safeParse({ targetId, ...(endTime === undefined ? {} : { endTime }) });
    if (!input.success) throw new ConnectorError('format', '历史消息读取参数无效。');
    const result = await this.withSession(serialized, async context => {
      const response = await context.post(`${origin}/api/im/getSessionMsgs`, { headers: { 'y-zp-business-type': 'B' }, data: { targetType: 'USER', ...input.data }, maxRedirects: 0 });
      try {
        if (response.status() === 401) throw new ConnectorError('expired', '智联登录已失效，请重新连接。');
        if (!response.ok()) throw new ConnectorError('platform', '历史消息读取被拒绝，请在官方页面检查账号状态。');
        const messages=parseHistory(await response.json());
        return withMessageDirections(messages,await readMessagingStaffId(context),peerPartnerId);
      } finally { await response.dispose(); }
    });
    return { session: result.session, messages: result.value };
  }
  async readResume(serialized: string, input: { readonly resumeNumber: string; readonly resumeLanguage: number; readonly jobNumber?: string }): Promise<{ readonly session: string; readonly text: string }> {
    const parsed = z.object({ resumeNumber: z.string().min(1).max(200), resumeLanguage: z.number().int().positive(), jobNumber: z.string().min(1).max(200).optional() }).safeParse(input);
    if (!parsed.success) throw new ConnectorError('format', '在线简历读取参数不完整。');
    const result = await this.withSession(serialized, async context => {
      const response = await context.post(`${origin}/api/im/getResumeDetail`, { headers: { 'y-zp-business-type': 'B' }, data: parsed.data, maxRedirects: 0 });
      try {
        if (response.status() === 401) throw new ConnectorError('expired', '智联登录已失效，请重新连接。');
        if (!response.ok()) throw new ConnectorError('platform', '在线简历读取被拒绝，请在官方页面检查权限。');
        return parseResume(readEnvelope(await response.json()));
      } finally { await response.dispose(); }
    });
    return { session: result.session, text: result.value };
  }
  async inspectAttachment(serialized: string, input: AttachmentInput): Promise<AttachmentResult & { readonly session: string }> {
    const result = await this.withSession(serialized, context => inspectAttachmentWithContext(context, input));
    return { ...result.value, session: result.session };
  }
  async checkReplyPermission(serialized: string, target: ReplyTarget): Promise<ReplyPermission & { readonly session: string }> {
    const result = await this.withSession(serialized, context => checkReplyPermissionUsing(replyTransport(context), target)); return { ...result.value, session: result.session };
  }
  async sendReply(serialized: string, input: ReplyInput, beforeSend: () => boolean): Promise<{ readonly session: string }> {
    let accepted = false, attempted = false;
    try { const result = await this.withSession(serialized, async context => { await sendReplyUsing(replyTransport(context), input, () => { const allowed = !this.disposed && beforeSend(); attempted = allowed; return allowed; }); accepted = true; }); return { session: result.session }; }
    catch (error) { if (accepted || (attempted && !(error instanceof ConnectorError))) throw new ReplyUncertainError(); throw error; }
  }
  async readIdentity(serialized: string): Promise<{ readonly session: string; readonly identity: string }> {
    const result = await this.withSession(serialized, async context => {
      const response = await context.get(`${origin}/api/session`, { headers: { 'y-zp-business-type': 'B' }, maxRedirects: 0 });
      try {
        if (response.status() === 401) throw new ConnectorError('expired', '智联登录已失效，请重新连接。');
        if (!response.ok()) throw new ConnectorError('platform', '账号身份读取被拒绝，请在官方页面检查账号状态。');
        const id = z.union([z.string().min(1).max(200), z.number().finite()]).transform(String);
        const data = z.object({ staff: z.object({ staffId: id }), org: z.object({ orgId: id }) }).safeParse(readEnvelope(await response.json()));
        if (!data.success) throw new ConnectorError('format', '智联账号身份字段不完整，无法验证账号唯一性。');
        return createHash('sha256').update(JSON.stringify(['zhilian', data.data.org.orgId, data.data.staff.staffId])).digest('hex');
      } finally { await response.dispose(); }
    });
    return { session: result.session, identity: result.value };
  }
  private async withSession<T>(serialized: string, operation: (context: APIRequestContext) => Promise<T>): Promise<{ readonly session: string; readonly value: T }> {
    if (this.disposed) throw new ConnectorError('cancelled', '软件正在关闭。');
    let saved: Session;
    try { saved = sessionSchema.parse(JSON.parse(serialized)); }
    catch (error) { if (error instanceof Error) throw new ConnectorError('expired', '本地登录资料不可用，请重新连接。'); throw error; }
    const context = await request.newContext({ storageState: { cookies: saved.cookies, origins: [] }, timeout: 20_000, maxRedirects: 0 });
    this.requests.add(context);
    try {
      if (this.disposed) throw new ConnectorError('cancelled', '软件正在关闭。');
      const value = await operation(context);
      const state = await context.storageState();
      return { value, session: JSON.stringify({ ...saved, cookies: state.cookies.filter(cookie => isZhilianDomain(cookie.domain)) }) };
    } catch (error) {
      if (error instanceof ConnectorError || error instanceof ReplyUncertainError) throw error;
      throw new ConnectorError('platform', '智联读取失败，请检查网络后重试。');
    } finally { this.requests.delete(context); await context.dispose(); }
  }
  private async readJobs(session: Session, accountId: string, signal?: AbortSignal): Promise<Connection> {
    const context = await request.newContext({ storageState: { cookies: session.cookies, origins: [] }, timeout: 20_000, maxRedirects: 0 });
    this.requests.add(context);
    try {
      if (this.disposed) throw new ConnectorError('cancelled', '软件正在关闭。');
      if (signal) assertActive(signal);
      readEnvelope(await this.read(context, '/api/auth/company/type'));
      if (signal) assertActive(signal);
      const jobs = parseJobs(await this.read(context, jobsPath, session.query, session.search), accountId);
      const state = await context.storageState();
      return { jobs, session: JSON.stringify({ ...session, cookies: state.cookies.filter(cookie => isZhilianDomain(cookie.domain)) }) };
    } catch (error) {
      if (error instanceof ConnectorError || error instanceof ReplyUncertainError) throw error;
      throw new ConnectorError('platform', '智联读取失败，请检查网络后重试。');
    } finally { this.requests.delete(context); await context.dispose(); }
  }
  private async read(context: APIRequestContext, path: '/api/auth/company/type' | typeof jobsPath, query?: Session['query'], search = ''): Promise<unknown> {
    const response = await context.fetch(`${origin}${path}${search}`, { method: query ? 'POST' : 'GET', ...(query ? { data: query } : {}), maxRedirects: 0, headers: { 'Cache-Control': 'no-cache' } });
    try {
      if (response.status() === 401) throw new ConnectorError('expired', '智联登录已失效，请重新连接账号。');
      if (!response.ok()) throw new ConnectorError('platform', '智联拒绝此次读取，请在官方页面检查账号状态。');
      return await response.json();
    } finally { await response.dispose(); }
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.cancel();
    await Promise.all([...this.requests].map(context => context.dispose()));
    this.requests.clear();
  }
}
