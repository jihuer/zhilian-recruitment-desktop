import { randomUUID } from 'node:crypto';
import { generateDraft } from './ai';
import { ConnectorError } from './connector';
import { ReplyUncertainError } from './reply-connector';
import type { Store } from './store';
import type { AutoReply, ReplyAttempt } from '../shared/contracts';
import { assertRunnable, batchSignature, candidateFor, confirmation, incomingBatch, latest, revision, targetFor, unresolved } from './auto-reply-state';
import type { AutoReplyConnector, AutoReplyOptions } from './auto-reply-state';

export class AutoReplyRunner{
 private timer:ReturnType<typeof setInterval>|undefined;
 private stopped=false;
 private busy=false;
 private readonly versions=new Map<string,number>();
 private readonly generate:typeof generateDraft;
 private readonly now:()=>number;
 constructor(private readonly store:Store,private readonly connector:AutoReplyConnector,private readonly changed:()=>void,private readonly locks:Set<string>,options:AutoReplyOptions={}){this.generate=options.generate??generateDraft;this.now=options.now??Date.now;}
 start():void{if(!this.timer&&!this.stopped)this.timer=setInterval(()=>{void this.tick();},1000);}
 private iso():string{return new Date(this.now()).toISOString();}
 private config(id:string):AutoReply|undefined{return this.store.state.autoReplies.find(c=>c.candidateId===id);}
 private bump(id:string):void{this.versions.set(id,(this.versions.get(id)??0)+1);}
 private save():void{if(!this.stopped)this.changed();}
 private pause(id:string,reason:string):void{const config=this.config(id);if(config){config.status='paused';config.reason=reason;}this.bump(id);this.save();}
 async action(id:string,action:'enableDraft'|'enableSend'|'pause'|'stop'|'check'|'reconcile'):Promise<void>{
  if(this.stopped)throw new TypeError('软件正在关闭');
  switch(action){
   case 'pause':this.pause(id,'已手动暂停');return;
   case 'stop':{const config=this.config(id);if(config){config.status='off';config.reason='已停止';}this.bump(id);this.save();return;}
   case 'enableDraft':case 'enableSend':await this.enable(id,action==='enableSend'?'send':'draft');return;
   case 'check':if(this.config(id)?.status!=='enabled')throw new TypeError('请先启用自动回复');await this.run(id);return;
   case 'reconcile':await this.reconcile(id);return;
   default:{const unreachable:never=action;throw new TypeError(String(unreachable));}
  }
 }
 private async enable(id:string,mode:'draft'|'send'):Promise<void>{
  const candidate=candidateFor(this.store.state,id);assertRunnable(this.store.state,candidate);if(mode==='send')targetFor(candidate);
  if(unresolved(this.store.state,id))throw new TypeError('存在尚未核对的回复，请先只读核对结果');
  if(this.locks.has(candidate.accountId))throw new TypeError('该账号正在处理其他请求');
  let session=this.store.secret('account:'+candidate.accountId);if(!session)throw new TypeError('请重新连接账号');
  this.locks.add(candidate.accountId);this.bump(id);const version=this.versions.get(id);
  const stamp=revision(this.store.state,id);
  const config:AutoReply={candidateId:id,mode,status:'paused',startedAt:this.iso(),nextCheckAt:this.iso(),lastMessageId:'',reason:'正在建立历史基线'};
  this.store.state.autoReplies=[config,...this.store.state.autoReplies.filter(c=>c.candidateId!==id)];this.save();
  try{
   if(mode==='send'){
    const permission=await this.connector.checkReplyPermission(session,targetFor(candidate));
    if(this.stopped)return;
    if(version!==this.versions.get(id)||stamp!==revision(this.store.state,id))throw new TypeError('配置或资料发生变化，请重新启用');
    if(!permission.allowed)throw new TypeError(permission.reason||'平台不允许回复');
    session=permission.session;
   }
   const result=await this.connector.readHistory(session,candidate.platformUserId??'',undefined,candidate.platformPeerPartnerId);
   if(this.stopped)return;
   if(version!==this.versions.get(id)||stamp!==revision(this.store.state,id))throw new TypeError('配置或资料发生变化，请重新启用');
   assertRunnable(this.store.state,candidateFor(this.store.state,id));
   this.store.setSecret('account:'+candidate.accountId,result.session);
   config.startedAt=this.iso();config.lastMessageId=latest(result.messages)?.id??'';config.status='enabled';config.nextCheckAt=new Date(this.now()+90_000).toISOString();config.reason='已建立基线，仅处理之后的新消息';this.save();
  }catch(error){if(!this.stopped)this.pause(id,error instanceof Error?error.message:'建立基线失败');throw error;}
  finally{this.locks.delete(candidate.accountId);}
 }
 async tick():Promise<void>{
  if(this.stopped||this.busy)return;
  for(const config of this.store.state.autoReplies){if(config.status==='enabled'&&Date.parse(config.nextCheckAt)<=this.now())await this.run(config.candidateId);}
 }
 private async run(id:string):Promise<void>{
  const config=this.config(id);if(this.stopped||this.busy||config?.status!=='enabled')return;
  const candidate=this.store.state.candidates.find(c=>c.id===id);if(!candidate){this.pause(id,'候选人已不存在');return;}if(this.locks.has(candidate.accountId))return;
  this.busy=true;this.locks.add(candidate.accountId);
  const version=this.versions.get(id);
  let stamp=revision(this.store.state,id);let attempt:ReplyAttempt|undefined;
  const active=():boolean=>{
   if(this.stopped||version!==this.versions.get(id)||this.config(id)!==config||config.status!=='enabled'||revision(this.store.state,id)!==stamp)return false;
   try{assertRunnable(this.store.state,candidateFor(this.store.state,id));return true;}catch(error){if(error instanceof TypeError)return false;throw error;}
  };
  try{
   assertRunnable(this.store.state,candidate);
   if(unresolved(this.store.state,id)){this.pause(id,'存在未确认回复，请先核对');return;}
   let session=this.store.secret('account:'+candidate.accountId);if(!session)throw new TypeError('登录资料不可用');
   config.nextCheckAt=new Date(this.now()+90_000).toISOString();this.save();
   const history=await this.connector.readHistory(session,candidate.platformUserId??'',undefined,candidate.platformPeerPartnerId);
   if(!active()){if(!this.stopped)this.pause(id,'资料或控制状态已变化');return;}
   session=history.session;this.store.setSecret('account:'+candidate.accountId,session);
   const batch=incomingBatch(this.store.state,id,history.messages,config.startedAt);
   const incoming=batch.at(-1);
   if(!incoming||incoming.id===config.lastMessageId)return;
   const batchReason=`合并${batch.length}条新消息`;
   const current=candidateFor(this.store.state,id);current.history=history.messages;current.updatedAt=this.iso();stamp=revision(this.store.state,id);
   const at=this.iso();attempt={id:randomUUID().replaceAll('-',''),candidateId:id,inboundId:incoming.id,inboundIds:batch.map(m=>m.id),status:'generating',text:'',createdAt:at,updatedAt:at,reason:batchReason+'，正在生成回复'};
   this.store.state.replyAttempts.push(attempt);config.lastMessageId=incoming.id;this.save();
   const job=this.store.state.jobs.find(j=>j.id===current.jobId&&j.accountId===current.accountId);if(!job)throw new TypeError('岗位不存在');
   const text=(await this.generate({candidate:{...current,message:batch.map(m=>m.text).join('\n')},job,rule:this.store.state.rules.find(r=>r.jobId===job.id),knowledge:this.store.state.knowledge,settings:this.store.state.settings,key:this.store.secret('ai-key')})).trim();
   if(this.stopped)return;
   if(!active()){attempt.status='discarded';attempt.reason=batchReason+'，生成期间资料或控制状态已变化';attempt.updatedAt=this.iso();this.save();return;}
   if(!text||text.length>4000)throw new TypeError('模型输出为空或超过回复长度上限');
   attempt.text=text;attempt.updatedAt=this.iso();
   if(config.mode==='draft'){candidateFor(this.store.state,id).draft=text;candidateFor(this.store.state,id).updatedAt=this.iso();attempt.status='drafted';attempt.reason=batchReason+'，草稿已生成，未发送';this.save();return;}
   const target=targetFor(candidateFor(this.store.state,id));
   const permission=await this.connector.checkReplyPermission(session,target);
   if(this.stopped)return;
   if(!active()){attempt.status='discarded';attempt.reason=batchReason+'，发送前资料或控制状态已变化';this.save();return;}
   if(!permission.allowed)throw new TypeError(permission.reason||'平台不允许回复');
   session=permission.session;
   const refreshed=await this.connector.readHistory(session,candidate.platformUserId??'',undefined,candidate.platformPeerPartnerId);
   if(this.stopped)return;
   const refreshedBatch=incomingBatch(this.store.state,id,refreshed.messages,config.startedAt,attempt.id);
   if(!active()||batchSignature(refreshedBatch)!==batchSignature(batch)){attempt.status='discarded';attempt.reason=batchReason+'，会话已变化，本次旧回复已丢弃';attempt.updatedAt=this.iso();this.save();return;}
   session=refreshed.session;this.store.setSecret('account:'+candidate.accountId,session);
   attempt.status='sending';attempt.updatedAt=this.iso();attempt.reason=batchReason+'，已记录固定发送编号，正在提交';this.save();
   const sent=await this.connector.sendReply(session,{target,content:text,sendMessageId:attempt.id},active);
   if(this.stopped)return;
   if(!active())this.pause(id,'提交期间资料或控制状态已变化，请核对发送结果');
   this.store.setSecret('account:'+candidate.accountId,sent.session);attempt.status='accepted';attempt.updatedAt=this.iso();attempt.reason=batchReason+'，平台已接受，等待历史确认';this.save();
   const verified=await this.connector.readHistory(sent.session,candidate.platformUserId??'',undefined,candidate.platformPeerPartnerId);
   if(this.stopped)return;
   if(confirmation(verified.messages,attempt)){attempt.status='confirmed';attempt.reason=batchReason+'，已从我方历史消息确认';attempt.updatedAt=this.iso();this.store.setSecret('account:'+candidate.accountId,verified.session);this.save();}
   else this.pause(id,'平台已接受但尚无历史确认，请只读核对，禁止重发');
  }catch(error){
   if(this.stopped)return;
   if(error instanceof ConnectorError&&error.code==='expired'){const account=this.store.state.accounts.find(a=>a.id===candidate.accountId);if(account)account.status='expired';}
   if(attempt){attempt.status=error instanceof ReplyUncertainError||attempt.status==='accepted'||(attempt.status==='sending'&&!(error instanceof ConnectorError))?'uncertain':error instanceof ConnectorError&&error.code==='cancelled'?'discarded':'failed';attempt.reason=`合并${attempt.inboundIds?.length??1}条新消息，`+(error instanceof ConnectorError||error instanceof TypeError?error.message:'回复处理失败，请核对结果');attempt.updatedAt=this.iso();}
   this.pause(id,attempt?.reason??(error instanceof Error?error.message:'自动回复已暂停'));
  }finally{this.busy=false;this.locks.delete(candidate.accountId);}
 }
 private async reconcile(id:string):Promise<void>{
  const candidate=candidateFor(this.store.state,id);
  if(!candidate.platformUserId||!this.store.state.accounts.some(a=>a.id===candidate.accountId&&a.status==='connected'))throw new TypeError('请先核验账号及会话');
  if(this.locks.has(candidate.accountId))throw new TypeError('该账号正在处理其他请求');
  const session=this.store.secret('account:'+candidate.accountId);if(!session)throw new TypeError('请重新连接账号');
  this.locks.add(candidate.accountId);
  try{
   const result=await this.connector.readHistory(session,candidate.platformUserId,undefined,candidate.platformPeerPartnerId);
   if(this.stopped)return;
   const current=candidateFor(this.store.state,id);if(current.accountId!==candidate.accountId||current.platformUserId!==candidate.platformUserId)throw new TypeError('会话关联已变化');
   this.store.setSecret('account:'+candidate.accountId,result.session);
   for(const attempt of this.store.state.replyAttempts)if(attempt.candidateId===id&&['accepted','uncertain','sending'].includes(attempt.status)&&confirmation(result.messages,attempt)){attempt.status='confirmed';attempt.updatedAt=this.iso();attempt.reason=`合并${attempt.inboundIds?.length??1}条新消息，已只读核对发送结果`;}
   this.save();
  }finally{this.locks.delete(candidate.accountId);}
 }
 stop():void{
  if(this.stopped)return;if(this.timer)clearInterval(this.timer);
  for(const config of this.store.state.autoReplies){if(config.status==='enabled'){config.status='paused';config.reason='应用已停止';}this.bump(config.candidateId);}
  for(const attempt of this.store.state.replyAttempts){if(['sending','accepted'].includes(attempt.status)){attempt.status='uncertain';attempt.reason=`合并${attempt.inboundIds?.length??1}条新消息，应用关闭前发送结果未确认`;}else if(attempt.status==='generating'){attempt.status='discarded';attempt.reason=`合并${attempt.inboundIds?.length??1}条新消息，应用已关闭`;}}
  this.changed();this.stopped=true;
 }
}
