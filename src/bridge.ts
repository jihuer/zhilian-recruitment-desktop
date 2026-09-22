import { useCallback, useEffect, useRef, useState } from 'react';
import { CommandSchema, StateSchema } from '../shared/contracts';
import type { Command, DesktopApi, State } from '../shared/contracts';

declare global { interface Window { readonly desktop?: DesktopApi } }
export type RunCommand = (command: Command) => Promise<boolean>;
export const emptyState: State = {
  knowledge:[], localModel:{phase:'idle',message:'尚未安装本地模型',progress:0,model:''},modelTest:{status:'idle',message:'',answer:'',at:'',sources:[]}, autoReplies: [], replyAttempts: [], accounts: [], jobs: [], candidates: [], templates: [], rules: [], tasks: [], events: [],
  settings: { chromePath: '', aiBaseUrl: '', aiModel: '', hasApiKey: false },
  connection: { phase: 'idle', message: '' }, capabilities: { jobs: false, conversations: false, greeting: false, reply: false },
};
export function useDesktop() {
  const [state, setState] = useState<State>(emptyState);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ readonly kind: 'error' | 'success'; readonly text: string } | null>(null);
  const running = useRef(false);
  const run: RunCommand = useCallback(async (command: Command) => {
    const desktop = window.desktop;
    if (!desktop) { setNotice({ kind: 'error', text: '请在桌面应用中连接账号；网页预览无法访问本地数据。' }); return false; }
    if (running.current) return false;
    running.current = true; setBusy(true); setNotice(null);
    try {
      const reply = await desktop.invoke(CommandSchema.parse(command));
      if (!reply.ok) { setNotice({ kind: 'error', text: reply.error }); return false; }
      setState(StateSchema.parse(reply.state));
      if (reply.message) setNotice({ kind: 'success', text: reply.message });
      return true;
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '操作失败，请稍后重试。' });
      return false;
    } finally { running.current = false; setBusy(false); }
  }, []);
  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    const unsubscribe = desktop.subscribe(next => {
      const parsed = StateSchema.safeParse(next);
      if (parsed.success) setState(parsed.data);
      else setNotice({ kind: 'error', text: '收到的数据格式异常，请重启应用。' });
    });
    void run({ type: 'state' });
    return unsubscribe;
  }, [run]);
  return { state, run, busy, notice, clearNotice: () => setNotice(null), native: Boolean(window.desktop) };
}
export function formatTime(value: string) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'; }
