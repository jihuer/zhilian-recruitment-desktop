import type { Candidate, State, ReplyAttempt } from '../shared/contracts';
import type { HistoryMessage } from './history-data';
import type { generateDraft } from './ai';

export type ReplyTarget={readonly sessionId:string;readonly resumeNumber:string;readonly resumeLanguage:string;readonly jobNumber?:string};
export type AutoReplyConnector={
 readonly readHistory:(session:string,targetId:string,endTime?:number,peerPartnerId?:string)=>Promise<{readonly session:string;readonly messages:HistoryMessage[]}>;
 readonly checkReplyPermission:(session:string,target:ReplyTarget)=>Promise<{readonly session:string;readonly allowed:boolean;readonly reason:string}>;
 readonly sendReply:(session:string,input:{readonly target:ReplyTarget;readonly content:string;readonly sendMessageId:string},beforeSend:()=>boolean)=>Promise<{readonly session:string}>;
};
export type AutoReplyOptions={readonly generate?:typeof generateDraft;readonly now?:()=>number};
export function candidateFor(state:State,id:string):Candidate{
 const candidate=state.candidates.find(c=>c.id===id);if(!candidate)throw new TypeError('候选人不存在');return candidate;
}
export function assertRunnable(state:State,candidate:Candidate):void{
 if(candidate.mode==='human')throw new TypeError('已人工接管，自动回复已暂停');
 if(candidate.source!=='platform'||!candidate.platformUserId)throw new TypeError('缺少平台会话标识');
 if(!state.accounts.some(a=>a.id===candidate.accountId&&a.status==='connected'))throw new TypeError('账号未连接');
 const job=state.jobs.find(j=>j.id===candidate.jobId&&j.accountId===candidate.accountId);
 if(!job||/下线|关闭|撤销|撤回|停止招聘|已结束|已删除|withdrawn|closed|offline|deleted/i.test(job.status))throw new TypeError('岗位不存在或已停止招聘');
 if(state.tasks.some(t=>t.status==='running'&&t.candidateIds.includes(candidate.id)))throw new TypeError('该候选人正在由本地话术任务处理');
}
export function targetFor(candidate:Candidate):ReplyTarget{
 if(!candidate.platformSessionId||!candidate.platformResumeNumber||!candidate.platformResumeLanguage||!/^\d+$/.test(candidate.platformResumeLanguage))throw new TypeError('缺少回复权限核验所需的会话简历标识');
 return {sessionId:candidate.platformSessionId,resumeNumber:candidate.platformResumeNumber,resumeLanguage:candidate.platformResumeLanguage,...(candidate.platformJobNumber?{jobNumber:candidate.platformJobNumber}:{})};
}
export function revision(state:State,id:string):string{
 const candidate=state.candidates.find(c=>c.id===id);
 return JSON.stringify({knowledge:state.knowledge.filter(d=>d.accountId===candidate?.accountId&&(d.scope==='company'||d.jobId===candidate.jobId)),candidate,job:state.jobs.find(j=>j.id===candidate?.jobId),rule:state.rules.find(r=>r.jobId===candidate?.jobId),settings:state.settings});
}
export function confirmation(messages:readonly HistoryMessage[],attempt:ReplyAttempt):boolean{
 return messages.some(m=>m.direction==='outgoing'&&m.kind==='text'&&m.text===attempt.text&&(m.clientMessageId===attempt.id||m.id===attempt.id));
}
export function latest(messages:readonly HistoryMessage[]):HistoryMessage|undefined{
 return [...messages].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
}
export function unresolved(state:State,id:string):boolean{
 return state.replyAttempts.some(a=>a.candidateId===id&&['generating','sending','accepted','uncertain'].includes(a.status));
}
export function incomingBatch(state:State,candidateId:string,messages:readonly HistoryMessage[],startedAt:string,ignoreAttemptId?:string):HistoryMessage[]{
 const covered=new Set(state.replyAttempts.filter(a=>a.candidateId===candidateId&&a.id!==ignoreAttemptId).flatMap(a=>[a.inboundId,...(a.inboundIds??[])]));
 const ordered=[...messages].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 const result:HistoryMessage[]=[];
 for(const message of ordered){
  if(message.direction!=='incoming'||message.kind!=='text'||!message.text.trim()||!Number.isFinite(Date.parse(message.at))||Date.parse(message.at)<=Date.parse(startedAt)||covered.has(message.id))break;
  result.unshift(message);
 }
 return result;
}
export function batchSignature(messages:readonly HistoryMessage[]):string{
 return JSON.stringify(messages.map(m=>({id:m.id,text:m.text,at:m.at})));
}
