import { saveKnowledge } from './knowledge-store';
import { revision } from './auto-reply-state';
import { randomUUID } from 'node:crypto';
import type { Command, Reply, State } from '../shared/contracts';
import { CommandSchema } from '../shared/contracts';
import { ConnectorError, ZhilianConnector } from './connector';
import { ModelSetup } from './model-setup';
import type { LocalModelManager } from './local-models';
import { cancelCodexDrafts } from './codex-draft';
import { downloadAttachment } from './attachment-file';
import { AutoReplyRunner } from './auto-reply';
import { TaskRunner } from './tasks';
import type { Store } from './store';

export class Service {
 readonly models:ModelSetup;
 readonly tasks:TaskRunner;
 readonly auto:AutoReplyRunner;
 private readonly connector=new ZhilianConnector();
 private readonly syncing=new Set<string>();
 private readonly drafting=new Set<string>();
 private closing=false;
 constructor(readonly store:Store,private readonly publish:(state:State)=>void,local?:LocalModelManager){this.models=new ModelSetup(store,()=>this.changed(),local);this.tasks=new TaskRunner(store,()=>this.changed());this.tasks.start();this.auto=new AutoReplyRunner(store,this.connector,()=>this.changed(),this.syncing,{generate:this.models.generate});this.auto.start();}
 changed():void{if(this.closing)return;this.store.save();this.publish(this.store.state);}
 async invoke(raw:unknown):Promise<Reply>{
  if(this.closing)return {ok:false,error:"软件正在关闭，请稍后重试"};
  try{const command=CommandSchema.parse(raw);const message=await this.execute(command);return {ok:true,state:this.store.state,...(message?{message}:{})};}
  catch(error){return {ok:false,error:error instanceof TypeError||error instanceof ConnectorError?error.message:'操作失败，请检查输入、连接状态或服务配置后重试'};}
 }
 private async execute(command:Command):Promise<string|void>{
  const s=this.store.state;
  switch(command.type){
   case 'state':return;
   case 'testModel':await this.models.test(command);return;
   case 'installLocalModel':this.models.install(command.model);return;
   case 'cancelLocalModel':this.models.cancel();return;
   case 'saveKnowledge':saveKnowledge(s,command.value);break;
   case 'deleteKnowledge':s.knowledge=s.knowledge.filter(item=>item.id!==command.id);break;
   case 'connect':
    if(!['idle','error'].includes(s.connection.phase))throw new TypeError('已有登录窗口，请完成或取消连接');
    s.connection={phase:'opening',message:'准备连接'};this.changed();void this.connect(command.name);return;
   case 'cancelConnect':await this.connector.cancel();s.connection={phase:'idle',message:'已取消连接'};break;
   case 'disconnect':
    if(this.syncing.has(command.id))throw new TypeError('岗位同步中，请稍后断开');
    for(const task of s.tasks)if(task.accountId===command.id&&['running','paused'].includes(task.status)){task.status='stopped';task.reason='账号已断开';}
    s.accounts=s.accounts.map(a=>a.id===command.id?{...a,status:'disconnected'}:a);
    for(const config of s.autoReplies)if(s.candidates.some(c=>c.id===config.candidateId&&c.accountId===command.id)){config.status='paused';config.reason='账号已断开';}
    this.store.setSecret('account:'+command.id,null);this.store.event('已断开账号并清理登录凭证');break;
   case 'checkReplyAccess':{
    const c=s.candidates.find(item=>item.id===command.id);const account=s.accounts.find(a=>a.id===c?.accountId);
    const session=c?this.store.secret('account:'+c.accountId):null;
    if(!c?.platformSessionId||!c.platformResumeNumber||!c.platformResumeLanguage||!session||account?.status!=='connected')throw new TypeError('请先连接并同步会话简历信息');
    if(this.syncing.has(account.id))throw new TypeError('该账号正在处理，请稍后再检查');
    this.syncing.add(account.id);
    try{const result=await this.connector.checkReplyPermission(session,{sessionId:c.platformSessionId,resumeNumber:c.platformResumeNumber,resumeLanguage:c.platformResumeLanguage,...(c.platformJobNumber?{jobNumber:c.platformJobNumber}:{})});if(this.closing)return;this.store.setSecret('account:'+account.id,result.session);return result.allowed?'平台发送权限检查通过；尚未执行发送':result.reason;}finally{this.syncing.delete(account.id);}
   }
   case 'autoReplyAction':await this.auto.action(command.id,command.action);return;
   case 'syncJobs':await this.sync(command.id);return;
   case 'syncConversations':await this.syncConversations(command.id);return;
   case 'loadHistory':return this.loadHistory(command.id,command.older);
   case 'loadResume':return this.loadResume(command.id);
   case 'verifyIdentity':return this.verifyIdentity(command.id);
   case 'saveTemplate':{
    const value={...command.value,id:command.value.id||randomUUID()};s.templates=[value,...s.templates.filter(t=>t.id!==value.id)];break;
   }
   case 'saveRule':
    if(!s.jobs.some(j=>j.id===command.value.jobId))throw new TypeError('岗位不存在');
    s.rules=[command.value,...s.rules.filter(r=>r.jobId!==command.value.jobId)];break;
   case 'saveCandidate':{
    const stored=s.candidates.find(c=>c.id===command.value.id);
    const platform=stored?.source==='platform';
    if(command.value.source==='platform'&&!platform)throw new TypeError('平台资料必须由同步获得');
    if(platform&&stored.accountId!==command.value.accountId)throw new TypeError('平台会话不能移动到其他账号');
    if(!(platform&&command.value.jobId==='')&&!s.jobs.some(j=>j.id===command.value.jobId&&j.accountId===command.value.accountId))throw new TypeError('请选择该账号下的有效岗位');
    if(!command.value.name.trim())throw new TypeError('请填写候选人称呼');
    const editable=platform?{...stored,jobId:command.value.jobId,resume:command.value.resume,draft:command.value.draft,mode:command.value.mode}:command.value;
    const value={...editable,id:command.value.id||randomUUID(),updatedAt:new Date().toISOString()};
    s.candidates=[value,...s.candidates.filter(c=>c.id!==value.id)];
    if(value.mode==='human')for(const config of s.autoReplies)if(config.candidateId===value.id){config.status='paused';config.reason='已人工接管';}
    break;
   }
   case 'generateDraft':await this.draft(command.id);return;
   case 'testCodex':await this.models.test({type:'testModel',value:{...s.settings,aiProvider:'codex',apiKey:''},question:'请问这个岗位薪资多少？'});return;
   case 'createTask':this.tasks.create(command.value);return;
   case 'taskAction':this.tasks.action(command.id,command.action);return;
   case 'saveSettings':{
    if(command.value.chromePath!==s.settings.chromePath)throw new TypeError('请通过本机文件选择窗口设置 Chrome');
    const url=new URL(command.value.aiBaseUrl);
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new TypeError('模型服务请使用 HTTPS 或本机 HTTP 地址');
    if(url.username||url.password||url.search||url.hash)throw new TypeError('模型服务地址格式不正确');
    const {apiKey,...settings}=command.value;
    if(apiKey.trim())this.store.setSecret('ai-key',apiKey.trim());
    else if(new URL(s.settings.aiBaseUrl).origin!==url.origin)this.store.setSecret('ai-key',null);
    s.settings={...settings,hasApiKey:Boolean(this.store.secret('ai-key'))};break;
   }
   case 'chooseChrome':case 'exportData':case 'downloadAttachment':throw new TypeError('请从桌面应用执行此操作');
   default:{const unreachable:never=command;throw new TypeError(String(unreachable));}
  }this.changed();
 }
 private async connect(name:string):Promise<void>{
  try{
   const result=await this.connector.connect({chromePath:this.store.state.settings.chromePath,onPhase:(phase,message)=>{this.store.state.connection={phase,message};this.changed();}});
   if(this.closing)return;
   const id=randomUUID();
   this.store.setSecret('account:'+id,result.session);
   this.store.state.accounts.push({id,name,company:'企业资料已验证',source:'智联招聘',status:'connected',lastSync:new Date().toISOString()});
   this.store.state.jobs.push(...result.jobs.map(j=>({...j,id:`${id}:${j.id}`,accountId:id})));
   this.store.state.connection={phase:'idle',message:'连接成功，登录 Chrome 已关闭'};
   this.store.event('智联账号已连接，Chrome 关闭后岗位读取成功');
  }catch(error){
   this.store.state.connection=error instanceof ConnectorError&&error.code==='cancelled'?{phase:'idle',message:'已取消连接'}:{phase:'error',message:error instanceof ConnectorError?error.message:'连接未完成，请重新连接'};
  }this.changed();
 }
 private async sync(id:string):Promise<void>{
  if(this.syncing.has(id))throw new TypeError('该账号正在同步');
  const account=this.store.state.accounts.find(a=>a.id===id);
  const session=this.store.secret('account:'+id);
  if(!account||!session)throw new TypeError('请先连接账号');
  this.syncing.add(id);
  try{
   const result=await this.connector.listJobs(session,id);
   if(this.closing)return;
   this.store.setSecret('account:'+id,result.session);
   this.store.state.jobs=[...this.store.state.jobs.filter(j=>j.accountId!==id),...result.jobs];
   account.status='connected';account.lastSync=new Date().toISOString();this.store.event('岗位同步完成');
  }catch(error){if(error instanceof ConnectorError&&error.code==='expired'){account.status='expired';for(const task of this.store.state.tasks)if(task.accountId===id&&task.status==='running'){task.status='paused';task.reason='登录已失效';}}throw error;}
  finally{this.syncing.delete(id);this.changed();}
 }
 private async draft(id:string):Promise<void>{
  if(this.drafting.has(id))throw new TypeError('正在生成草稿，请稍候');
  const candidate=this.store.state.candidates.find(c=>c.id===id);
  if(!candidate)throw new TypeError('候选人不存在');
  if(candidate.mode==='human')throw new TypeError('当前已人工接管，请先恢复草稿模式');
  const job=this.store.state.jobs.find(j=>j.id===candidate.jobId);if(!job)throw new TypeError('岗位不存在');
  const stamp=revision(this.store.state,id);this.drafting.add(id);
  try{
   const text=await this.models.generate({candidate,job,knowledge:this.store.state.knowledge,rule:this.store.state.rules.find(r=>r.jobId===job.id),settings:this.store.state.settings,key:this.store.secret('ai-key')});
   const current=this.store.state.candidates.find(c=>c.id===id);
   if(this.closing)return;
   if(!current||revision(this.store.state,id)!==stamp||current.mode==='human')throw new TypeError('资料已更新或已人工接管，本次草稿已丢弃，请重新生成');
   current.draft=text;current.updatedAt=new Date().toISOString();this.store.event('已生成 AI 草稿，等待人工审核');this.changed();
  }finally{this.drafting.delete(id);}
 }
 private async syncConversations(id:string):Promise<void>{
  if(this.syncing.has(id))throw new TypeError('该账号正在同步，请稍候');
  const account=this.store.state.accounts.find(a=>a.id===id);
  const session=this.store.secret('account:'+id);
  if(!account||account.status!=='connected'||!session)throw new TypeError('请先验证账号连接');
  this.syncing.add(id);
  try{
   const result=await this.connector.listConversations(session,id);
   if(this.closing)return;
   this.store.setSecret('account:'+id,result.session);
   for(const summary of result.conversations){
    const previous=this.store.state.candidates.find(c=>c.id===summary.id);
    const contentChanged=previous?.message!==summary.message||previous?.platformUpdatedAt!==summary.platformUpdatedAt;
    const resumeChanged=previous?.platformResumeNumber!==summary.platformResumeNumber||previous?.platformResumeLanguage!==summary.platformResumeLanguage||previous?.platformJobNumber!==summary.platformJobNumber;
    const candidate={...previous,...summary,platformResumeNumber:summary.platformResumeNumber,platformResumeLanguage:summary.platformResumeLanguage,platformJobNumber:summary.platformJobNumber,platformResumeText:resumeChanged?undefined:previous?.platformResumeText,platformResumeFetchedAt:resumeChanged?undefined:previous?.platformResumeFetchedAt,accountId:id,source:'platform' as const,jobId:previous?.jobId??'',resume:previous?.resume??'',mode:previous?.mode??'draft' as const,draft:contentChanged||resumeChanged?'':previous?.draft??'',updatedAt:contentChanged||resumeChanged?new Date().toISOString():previous?.updatedAt??new Date().toISOString()};
    this.store.state.candidates=[candidate,...this.store.state.candidates.filter(c=>c.id!==candidate.id)];
   }
   this.store.state.capabilities.conversations=true;
   account.lastSync=new Date().toISOString();
   this.store.event(`已同步最近一页会话摘要：${result.conversations.length} 条；未标记已读、未发送消息`);
  }catch(error){
   if(error instanceof ConnectorError&&error.code==='expired'){account.status='expired';for(const task of this.store.state.tasks)if(task.accountId===id&&task.status==='running'){task.status='paused';task.reason='登录已失效';}}
   throw error;
  }finally{this.syncing.delete(id);this.changed();}
 }
 private async loadResume(id:string):Promise<string|void>{
  const selected=this.store.state.candidates.find(c=>c.id===id);
  if(!selected||selected.source!=='platform'||!selected.platformResumeNumber||!selected.platformResumeLanguage||!/^\d+$/.test(selected.platformResumeLanguage))throw new TypeError('当前会话缺少有效简历定位信息，请先同步会话摘要');
  const account=this.store.state.accounts.find(a=>a.id===selected.accountId);const session=this.store.secret('account:'+selected.accountId);
  if(!account||account.status!=='connected'||!session)throw new TypeError('请先验证账号连接');
  if(this.syncing.has(account.id))throw new TypeError('该账号正在读取，请稍候');
  this.syncing.add(account.id);
  try{
   const result=await this.connector.readResume(session,{resumeNumber:selected.platformResumeNumber,resumeLanguage:Number(selected.platformResumeLanguage),...(selected.platformJobNumber?{jobNumber:selected.platformJobNumber}:{})});
   if(this.closing)return;
   const current=this.store.state.candidates.find(c=>c.id===id);
   if(!current||current.platformResumeNumber!==selected.platformResumeNumber||current.platformResumeLanguage!==selected.platformResumeLanguage||current.platformJobNumber!==selected.platformJobNumber)throw new TypeError('简历关联已变化，本次结果已丢弃');
   this.store.setSecret('account:'+account.id,result.session);
   current.platformResumeText=result.text;current.platformResumeFetchedAt=new Date().toISOString();current.updatedAt=current.platformResumeFetchedAt;current.draft='';
   this.store.event('已读取平台可见在线简历卡片，未调用下载、解锁或已读接口');return '在线简历卡片已读取；附件和完整简历不在本次读取范围';
  }catch(error){if(error instanceof ConnectorError&&error.code==='expired'){account.status='expired';for(const task of this.store.state.tasks)if(task.accountId===account.id&&task.status==='running'){task.status='paused';task.reason='登录已失效';}}throw error;}
  finally{this.syncing.delete(account.id);this.changed();}
 }
 private async loadHistory(id:string,older=false):Promise<string|void>{
  let candidate=this.store.state.candidates.find(c=>c.id===id);
  if(!candidate||candidate.source!=='platform'||!candidate.platformUserId)throw new TypeError('请先重新同步会话摘要以取得历史读取标识');
  const accountId=candidate.accountId;
  const account=this.store.state.accounts.find(a=>a.id===accountId);
  const session=this.store.secret('account:'+accountId);
  if(!account||account.status!=='connected'||!session)throw new TypeError('请先验证账号连接');
  if(this.syncing.has(account.id))throw new TypeError('该账号正在读取，请稍候');
  if(older&&!candidate.history?.length)throw new TypeError('请先读取最近历史');
  if((candidate.history?.length??0)>=1000)throw new TypeError('已达到本地历史上限，请在智联查看更早记录');
  this.syncing.add(account.id);
  try{
   const earliest=candidate.history?.[0];
   const result=await this.connector.readHistory(session,candidate.platformUserId,older&&earliest?new Date(earliest.at).getTime():undefined,candidate.platformPeerPartnerId);
   if(this.closing)return;
   this.store.setSecret('account:'+account.id,result.session);
   candidate=this.store.state.candidates.find(c=>c.id===id);
   if(!candidate)return;
   const merged=new Map((candidate.history??[]).map(item=>[item.id,item]));
   const before=merged.size;for(const item of result.messages)merged.set(item.id,item);
   candidate.history=[...merged.values()].sort((a,b)=>a.at.localeCompare(b.at)).slice(-1000);
   candidate.historyFetchedAt=new Date().toISOString();candidate.updatedAt=candidate.historyFetchedAt;candidate.draft='';
   this.store.event(`历史消息读取完成：本次 ${result.messages.length} 条；未调用已读回执接口`);
   return merged.size===before?'本次没有新增历史消息；不代表已取得全部历史':`已读取 ${result.messages.length} 条历史消息，草稿已清空，请重新核对上下文`;
  }catch(error){if(error instanceof ConnectorError&&error.code==='expired'){account.status='expired';for(const task of this.store.state.tasks)if(task.accountId===account.id&&task.status==='running'){task.status='paused';task.reason='账号连接或身份验证已失效';}}throw error;}
  finally{this.syncing.delete(account.id);this.changed();}
 }
 private async verifyIdentity(id:string):Promise<string|void>{
  const account=this.store.state.accounts.find(a=>a.id===id);const session=this.store.secret('account:'+id);
  if(!account||!session||account.status==='disconnected')throw new TypeError('请先连接账号');
  if(this.syncing.has(id))throw new TypeError('该账号正在读取，请稍候');
  this.syncing.add(id);
  try{
   const result=await this.connector.readIdentity(session);if(this.closing)return;
   if(account.platformIdentity&&account.platformIdentity!==result.identity){account.status='expired';throw new TypeError('账号身份与原记录不一致，已停止使用，请重新连接');}
   this.store.setSecret('account:'+id,result.session);account.platformIdentity=result.identity;account.identityVerifiedAt=new Date().toISOString();
   this.store.event('已核对智联企业与招聘者身份');return '账号身份验证成功';
  }catch(error){if((error instanceof ConnectorError&&error.code==='expired')||account.status==='expired'){account.status='expired';for(const task of this.store.state.tasks)if(task.accountId===account.id&&task.status==='running'){task.status='paused';task.reason='账号连接或身份验证已失效';}}throw error;}
  finally{this.syncing.delete(id);this.changed();}
 }
 async prepareAttachment(id:string){
  if(this.closing)throw new TypeError('软件正在关闭');
  const candidate=this.store.state.candidates.find(c=>c.id===id);
  if(!candidate||candidate.source!=='platform'||!candidate.platformSessionId||!candidate.platformResumeNumber||!candidate.platformResumeLanguage)throw new TypeError('请先同步该会话的简历信息');
  const account=this.store.state.accounts.find(a=>a.id===candidate.accountId);const session=this.store.secret('account:'+candidate.accountId);
  if(!account||account.status!=='connected'||!session)throw new TypeError('请先验证账号连接');
  if(this.syncing.has(account.id))throw new TypeError('该账号正在读取，请稍候');
  this.syncing.add(account.id);
  try{
   const result=await this.connector.inspectAttachment(session,{sessionId:candidate.platformSessionId,resumeNumber:candidate.platformResumeNumber,resumeLanguage:candidate.platformResumeLanguage,...(candidate.platformJobNumber?{jobNumber:candidate.platformJobNumber}:{})});
   if(this.closing)throw new TypeError('软件正在关闭');
   this.store.setSecret('account:'+account.id,result.session);
   if(result.status==='blocked')throw new TypeError(result.reason);
   const host=new URL(result.attachment.url).hostname;
   if(!['zhaopin.com','zhaopin.cn'].some(domain=>host===domain||host.endsWith('.'+domain)))throw new TypeError(`附件存储域名尚未核对：${host}`);
   const file=await downloadAttachment({url:result.attachment.url,allowedHosts:[host],filename:'附件简历'});
   if(this.closing)throw new TypeError('软件正在关闭');
   return file;
  }catch(error){if(error instanceof ConnectorError&&error.code==='expired'){account.status='expired';for(const task of this.store.state.tasks)if(task.accountId===account.id&&task.status==='running'){task.status='paused';task.reason='登录已失效';}}throw error;}
  finally{this.syncing.delete(account.id);this.changed();}
 }
 async close():Promise<void>{this.models.close();this.closing=true;this.auto.stop();cancelCodexDrafts();this.tasks.stop();await this.connector.dispose();this.store.close();}
}
