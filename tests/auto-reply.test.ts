import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../desktop/store';
import { AutoReplyRunner } from '../desktop/auto-reply';
import type { AutoReplyConnector } from '../desktop/auto-reply-state';
import type { HistoryMessage } from '../desktop/history-data';
import { ConnectorError } from '../desktop/connector';
import { ReplyUncertainError } from '../desktop/reply-connector';

const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const close of cleanups.splice(0))close();});
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'auto-reply-test-'));
 const store=await Store.open(directory,{encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>Buffer.from(s,'base64').toString()});
 store.state.accounts.push({id:'a',name:'fixture',company:'fixture',source:'智联招聘',status:'connected',lastSync:''});
 store.state.jobs.push({id:'a:j',accountId:'a',title:'岗位',city:'',salary:'',status:'招聘中'});
 store.state.candidates.push({id:'a:c',accountId:'a',jobId:'a:j',name:'资料',resume:'手工资料',message:'',draft:'',mode:'draft',updatedAt:'original',source:'platform',platformUserId:'u',platformPeerPartnerId:'peer',platformSessionId:'s',platformResumeNumber:'r',platformResumeLanguage:'1'});
 store.setSecret('account:a','fixture-session');
 let now=Date.parse('2026-01-01T00:00:00.000Z');let messages:HistoryMessage[]=[];let sends=0;let generations=0;let reads=0;
 const controls={confirm:true,permission:true,beforePost:()=>{},sendWait:async()=>{},modelMessage:'',modelHistory:[] as string[],sendError:undefined as Error|undefined,generate:async()=> '请问您方便哪天沟通？'};
 const io:AutoReplyConnector={
  readHistory:async()=>{reads++;return {session:'fixture-session',messages:[...messages]};},
  checkReplyPermission:async()=>({session:'fixture-session',allowed:controls.permission,reason:'fixture permission denied'}),
  sendReply:async(_session,input,beforeSend)=>{
   expect(store.state.replyAttempts[0]?.status).toBe('sending');
   controls.beforePost();if(!beforeSend())throw new ConnectorError('cancelled','fixture cancelled');sends++;await controls.sendWait();
   if(controls.sendError)throw controls.sendError;
   if(controls.confirm)messages.push({id:'server-reply',clientMessageId:input.sendMessageId,text:input.content,direction:'outgoing',kind:'text',senderId:'self',at:new Date(now+1).toISOString()});
   return {session:'fixture-session'};
  },
 };
 const locks=new Set<string>();
 const runner=new AutoReplyRunner(store,io,()=>store.save(),locks,{now:()=>now,generate:async input=>{controls.modelMessage=input.candidate.message;controls.modelHistory=input.candidate.history?.map(m=>m.id)??[];generations++;expect(store.state.replyAttempts[0]?.status).toBe('generating');return controls.generate();}});
 cleanups.push(()=>{runner.stop();store.close();rmSync(directory,{recursive:true,force:true});});
 const inbound=(patch:Partial<HistoryMessage>={})=>{now+=1000;messages=[{id:'incoming',text:'薪资情况？',direction:'incoming',kind:'text',senderId:'peer',at:new Date(now).toISOString(),...patch}];};
 return {store,runner,locks,controls,inbound,setMessages:(value:HistoryMessage[])=>{messages=value;},advance:()=>{now+=90001;},counts:()=>({sends,generations,reads})};
}
test('默认关闭且启用先建立基线，不回复旧消息',async()=>{
 const f=await fixture();f.inbound();await f.runner.tick();expect(f.counts().reads).toBe(0);
 await f.runner.action('a:c','enableSend');await f.runner.action('a:c','check');
 expect(f.counts().sends).toBe(0);expect(f.store.state.replyAttempts).toHaveLength(0);
});
test('新入站文本生成本地草稿且同inbound账本去重',async()=>{
 const f=await fixture();await f.runner.action('a:c','enableDraft');f.inbound();await f.runner.action('a:c','check');await f.runner.action('a:c','check');
 expect(f.counts().generations).toBe(1);expect(f.counts().sends).toBe(0);expect(f.store.state.replyAttempts[0]?.status).toBe('drafted');expect(f.store.state.candidates[0]?.draft).not.toBe('');
});
for(const patch of [{direction:'outgoing' as const},{direction:'unknown' as const},{text:''},{kind:'image'}])test(`非可回复末条消息跳过 ${JSON.stringify(patch)}`,async()=>{
 const f=await fixture();await f.runner.action('a:c','enableSend');f.inbound(patch);await f.runner.action('a:c','check');expect(f.counts().generations).toBe(0);expect(f.counts().sends).toBe(0);
});
test('发送前持久化固定编号并通过历史outgoing确认，禁止重发',async()=>{
 const f=await fixture();await f.runner.action('a:c','enableSend');f.inbound();await f.runner.action('a:c','check');
 expect(f.store.state.replyAttempts[0]?.id).toMatch(/^[a-f0-9]{32}$/);expect(f.store.state.replyAttempts[0]?.status).toBe('confirmed');
 f.inbound();await f.runner.action('a:c','check');expect(f.counts().sends).toBe(1);
});
for(const change of ['pause','human','edit','rule','withdrawn'] as const)test(`生成期间${change}丢弃结果且不发送`,async()=>{
 const f=await fixture();await f.runner.action('a:c','enableSend');f.inbound();
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();f.controls.generate=async()=>{entered.resolve();await release.promise;return '旧草稿';};
 const pending=f.runner.action('a:c','check');await entered.promise;
 const candidate=f.store.state.candidates[0],job=f.store.state.jobs[0];if(!candidate||!job)throw new TypeError('fixture');
 if(change==='pause')await f.runner.action('a:c','pause');
 if(change==='human')candidate.mode='human';if(change==='edit')candidate.resume='修改资料';
 if(change==='withdrawn')job.status='平台状态 WITHDRAWN';
 if(change==='rule')f.store.state.rules.push({jobId:job.id,facts:'变化',faq:'',questions:'',skills:''});
 release.resolve();await pending;
 expect(f.store.state.replyAttempts[0]?.status).toBe('discarded');expect(f.counts().sends).toBe(0);
});
for(const error of [new ReplyUncertainError(),new ConnectorError('platform','拒绝')])test(`发送${error.name}暂停且不自动重发`,async()=>{
 const f=await fixture();f.controls.sendError=error;await f.runner.action('a:c','enableSend');f.inbound();await f.runner.action('a:c','check');f.advance();await f.runner.tick();
 expect(f.counts().sends).toBe(1);expect(f.store.state.autoReplies[0]?.status).toBe('paused');expect(f.store.state.replyAttempts[0]?.status).toBe(error instanceof ReplyUncertainError?'uncertain':'failed');
});
test('accepted无回读先暂停，reconcile仅查询且匹配编号正文方向才确认',async()=>{
 const f=await fixture();f.controls.confirm=false;await f.runner.action('a:c','enableSend');f.inbound();await f.runner.action('a:c','check');
 const attempt=f.store.state.replyAttempts[0];if(!attempt)throw new TypeError('fixture');expect(attempt.status).toBe('accepted');
 await expect(f.runner.action('a:c','enableSend')).rejects.toThrow();
 f.setMessages([{id:'server',clientMessageId:attempt.id,text:attempt.text,direction:'outgoing',kind:'text',senderId:'self',at:'2026-01-01T00:00:02.000Z'}]);
 await f.runner.action('a:c','reconcile');expect(attempt.status).toBe('confirmed');expect(f.counts().sends).toBe(1);expect(f.store.state.autoReplies[0]?.status).toBe('paused');
});
test('共享账号锁跳过且90秒内tick不请求',async()=>{
 const f=await fixture();await f.runner.action('a:c','enableDraft');f.inbound();await f.runner.tick();expect(f.counts().reads).toBe(1);
 f.advance();f.locks.add('a');await f.runner.tick();expect(f.counts().reads).toBe(1);f.locks.delete('a');await f.runner.tick();expect(f.counts().generations).toBe(1);
});
test('stop期间生成结果不会写入关闭后的store',async()=>{
 const f=await fixture();await f.runner.action('a:c','enableSend');f.inbound();
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();f.controls.generate=async()=>{entered.resolve();await release.promise;return '旧草稿';};
 const pending=f.runner.action('a:c','check');await entered.promise;f.runner.stop();const snapshot=JSON.stringify(f.store.state);release.resolve();await pending;
 expect(JSON.stringify(f.store.state)).toBe(snapshot);expect(f.store.state.replyAttempts[0]?.status).toBe('discarded');expect(f.counts().sends).toBe(0);
});
test('最后beforeSend检查拒绝已停用配置，账本discarded且零POST',async()=>{
 const f=await fixture();await f.runner.action('a:c','enableSend');f.inbound();
 f.controls.beforePost=()=>{const config=f.store.state.autoReplies[0];if(config)config.status='paused';};
 await f.runner.action('a:c','check');expect(f.counts().sends).toBe(0);expect(f.store.state.replyAttempts[0]?.status).toBe('discarded');
});
test('POST进行中关闭标为uncertain，迟到结果不更新关闭状态',async()=>{
 const f=await fixture();await f.runner.action('a:c','enableSend');f.inbound();
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();f.controls.sendWait=async()=>{entered.resolve();await release.promise;};
 const pending=f.runner.action('a:c','check');await entered.promise;f.runner.stop();const snapshot=JSON.stringify(f.store.state);release.resolve();await pending;
 expect(f.store.state.replyAttempts[0]?.status).toBe('uncertain');expect(JSON.stringify(f.store.state)).toBe(snapshot);expect(f.counts().sends).toBe(1);
});
test('全局并发tick和manual check只生成一次',async()=>{
 const f=await fixture();await f.runner.action('a:c','enableDraft');f.inbound();f.advance();
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();f.controls.generate=async()=>{entered.resolve();await release.promise;return '草稿';};
 const pending=f.runner.tick();await entered.promise;await f.runner.tick();await f.runner.action('a:c','check');release.resolve();await pending;
 expect(f.counts().generations).toBe(1);expect(f.store.state.replyAttempts).toHaveLength(1);
});
test('平台权限拒绝在POST之前失败暂停',async()=>{
 const f=await fixture();await f.runner.action('a:c','enableSend');f.controls.permission=false;f.inbound();await f.runner.action('a:c','check');
 expect(f.counts().sends).toBe(0);expect(f.store.state.replyAttempts[0]?.status).toBe('failed');expect(f.store.state.autoReplies[0]?.status).toBe('paused');
});
test('带平台前缀WITHDRAWN岗位禁止启用',async()=>{
 const f=await fixture();const job=f.store.state.jobs[0];if(!job)throw new TypeError('fixture');job.status='平台状态 WITHDRAWN';
 await expect(f.runner.action('a:c','enableSend')).rejects.toThrow();expect(f.counts().reads).toBe(0);
});
test('模型使用本次入站问句而非陈旧摘要',async()=>{
 const f=await fixture();const candidate=f.store.state.candidates[0];if(candidate)candidate.message='旧摘要';
 await f.runner.action('a:c','enableDraft');f.inbound({text:'新的具体问题'});await f.runner.action('a:c','check');
 expect(f.controls.modelMessage).toBe('新的具体问题');
});
for(const direction of ['incoming','outgoing'] as const)test(`模型期间官方会话新增${direction}会丢弃旧答案`,async()=>{
 const f=await fixture();await f.runner.action('a:c','enableSend');f.inbound();
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();f.controls.generate=async()=>{entered.resolve();await release.promise;return '旧回答';};
 const pending=f.runner.action('a:c','check');await entered.promise;f.inbound({id:'newer',direction,text:'后续消息'});release.resolve();await pending;
 expect(f.store.state.replyAttempts[0]?.status).toBe('discarded');expect(f.counts().sends).toBe(0);
});
test('启用发送模式先反馈权限拒绝，草稿模式不受发送权限限制',async()=>{
 const f=await fixture();f.controls.permission=false;
 await expect(f.runner.action('a:c','enableSend')).rejects.toThrow();expect(f.store.state.autoReplies[0]?.status).toBe('paused');expect(f.counts().reads).toBe(0);
 await f.runner.action('a:c','enableDraft');expect(f.store.state.autoReplies[0]?.status).toBe('enabled');
});
function batchMessages():HistoryMessage[]{
 return [{id:'prior',text:'此前我方上下文',direction:'outgoing',kind:'text',senderId:'self',at:'2025-12-31T23:59:59.000Z'},...['薪资多少？','在哪上班？','周末休息吗？'].map((text,index)=>({id:`batch-${index}`,text,direction:'incoming' as const,kind:'text',senderId:'peer',at:`2026-01-01T00:00:0${index+1}.000Z`}))];
}
test('连续三条新消息合并一次生成和发送，账本覆盖全部且保留原历史',async()=>{
 const f=await fixture();await f.runner.action('a:c','enableSend');const messages=batchMessages();f.setMessages(messages);
 await f.runner.action('a:c','check');
 expect(f.counts().generations).toBe(1);expect(f.counts().sends).toBe(1);
 expect(f.controls.modelMessage).toBe('薪资多少？\n在哪上班？\n周末休息吗？');expect(f.controls.modelHistory).toEqual(['prior','batch-0','batch-1','batch-2']);
 expect(f.store.state.replyAttempts[0]?.inboundIds).toEqual(['batch-0','batch-1','batch-2']);expect(f.store.state.replyAttempts[0]?.inboundId).toBe('batch-2');
 f.setMessages(messages.slice(0,3));await f.runner.action('a:c','check');expect(f.counts().sends).toBe(1);expect(f.counts().generations).toBe(1);
});
test('批次中较早消息同ID内容改变会阻止发送',async()=>{
 const f=await fixture();await f.runner.action('a:c','enableSend');const messages=batchMessages();f.setMessages(messages);
 f.controls.generate=async()=>{f.setMessages(messages.map(m=>m.id==='batch-0'?{...m,text:'已修改问题'}:m));return '旧答案';};
 await f.runner.action('a:c','check');expect(f.counts().sends).toBe(0);expect(f.store.state.replyAttempts[0]?.status).toBe('discarded');
});
test('合并遇非文本或未知发送方向即截断，仅覆盖其后的连续文本',async()=>{
 const f=await fixture();await f.runner.action('a:c','enableDraft');const messages=batchMessages();f.setMessages(messages.map(m=>m.id==='batch-1'?{...m,direction:'unknown'}:m));
 await f.runner.action('a:c','check');expect(f.controls.modelMessage).toBe('周末休息吗？');expect(f.store.state.replyAttempts[0]?.inboundIds).toEqual(['batch-2']);
});
