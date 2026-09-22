import {z} from 'zod';
import type {Store} from './store';
import type {AutoReplyConnector} from './auto-reply-state';
import {confirmation,targetFor,unresolved} from './auto-reply-state';
import type {ReplyAttempt} from '../shared/contracts';
import {ConnectorError} from './connector-data';
import {ReplyUncertainError} from './reply-connector';

export const SendOnceSchema=z.object({candidateName:z.string().min(1),content:z.string().trim().min(1).max(4000),sendMessageId:z.string().regex(/^[a-f0-9]{32}$/),jobTitle:z.string().min(1),jobState:z.string().min(1),city:z.string().min(1)});
export type SendOnceInput=z.infer<typeof SendOnceSchema>;
export async function sendOnce(store:Store,connector:AutoReplyConnector,input:SendOnceInput){
 const matches=store.state.candidates.filter(c=>c.name===input.candidateName&&c.source==='platform');
 if(matches.length!==1)throw new TypeError('接收人不是唯一的平台会话，已停止');
 const candidate=matches[0];if(!candidate?.platformUserId)throw new TypeError('会话缺少历史核验标识');
 const account=store.state.accounts.find(a=>a.id===candidate.accountId);
 if(!account||account.status!=='connected')throw new TypeError('账号尚未验证');
 if(!store.state.jobs.some(j=>j.accountId===account.id&&j.title===input.jobTitle&&j.city===input.city&&j.status.includes(input.jobState)))throw new TypeError('岗位事实已变化，停止发送旧内容');
 const target=targetFor(candidate);let session=store.secret('account:'+account.id);if(!session)throw new TypeError('缺少授权会话');
 const existing=store.state.replyAttempts.find(a=>a.id===input.sendMessageId||a.candidateId===candidate.id&&a.text===input.content);
 if(existing&&(existing.candidateId!==candidate.id||existing.text!==input.content))throw new TypeError('消息编号关联不匹配');
 let attempt:ReplyAttempt;
 let submitted=false;
 if(existing)attempt=existing;
 else{
  if(unresolved(store.state,candidate.id))throw new TypeError('此会话尚有待核对消息，不再发送');
  const permission=await connector.checkReplyPermission(session,target);if(!permission.allowed)throw new TypeError(permission.reason);
  session=permission.session;store.setSecret('account:'+account.id,session);
  const now=new Date().toISOString();
  attempt={id:input.sendMessageId,candidateId:candidate.id,inboundId:'manual:'+input.sendMessageId,status:'sending',text:input.content,createdAt:now,updatedAt:now,reason:'用户明确授权单条手动发送'};
  store.state.replyAttempts.push(attempt);store.save();
  try{
   const result=await connector.sendReply(session,{target,content:input.content,sendMessageId:input.sendMessageId},()=>account.status==='connected'&&store.state.candidates.some(c=>c.id===candidate.id&&c.platformSessionId===target.sessionId));
   submitted=true;session=result.session;store.setSecret('account:'+account.id,session);attempt.status='accepted';attempt.reason='平台已接受，待历史核对';
  }catch(error){
   attempt.status=error instanceof ReplyUncertainError||!(error instanceof ConnectorError)?'uncertain':'failed';
   attempt.reason=error instanceof ConnectorError?error.message:'单次请求结果待核对，未自动重发';
  }
  attempt.updatedAt=new Date().toISOString();store.save();
 }
 if(attempt.status==='accepted'||attempt.status==='uncertain'||attempt.status==='sending'){
  try{
   const history=await connector.readHistory(session,candidate.platformUserId,undefined,candidate.platformPeerPartnerId);
   store.setSecret('account:'+account.id,history.session);candidate.history=history.messages;candidate.historyFetchedAt=new Date().toISOString();
   if(confirmation(history.messages,attempt)){attempt.status='confirmed';attempt.reason='已按固定消息编号、我方方向与正文在平台历史确认';}
   attempt.updatedAt=new Date().toISOString();store.save();
  }catch(error){if(!(error instanceof Error))throw error;attempt.reason='发送结果尚未完成历史核对，禁止重发';store.save();}
 }
 return {status:attempt.status,sendMessageId:attempt.id,submittedThisRun:submitted,reason:attempt.reason,confirmedMatches:(candidate.history??[]).filter(m=>m.direction==='outgoing'&&m.kind==='text'&&m.text===attempt.text&&(m.clientMessageId===attempt.id||m.id===attempt.id)).length};
}
