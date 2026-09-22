import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AutoReplyRunner} from '../desktop/auto-reply';
import type {AutoReplyConnector} from '../desktop/auto-reply-state';
import type {HistoryMessage} from '../desktop/history-data';
import {Store} from '../desktop/store';

const directory=await mkdtemp(join(tmpdir(),'recruitment-auto-qa-'));
const store=await Store.open(directory,{encrypt:value=>value,decrypt:value=>value});
let clock=Date.now();
let history:HistoryMessage[]=[{id:'baseline',text:'您好，请问想了解什么？',kind:'text',at:new Date(clock-1000).toISOString(),senderId:'fixture-self',direction:'outgoing'}];
let sendCalls=0;
const connector:AutoReplyConnector={
 readHistory:async()=>({session:'fixture-only',messages:history}),
 checkReplyPermission:async()=>({session:'fixture-only',allowed:false,reason:'此验证禁止平台发送'}),
 sendReply:async()=>{sendCalls++;throw new TypeError('测试禁止发送');},
};
store.state.accounts=[{id:'a',name:'虚构测试账号',status:'connected',lastSync:'',company:'虚构',source:'智联招聘'}];
store.state.jobs=[{id:'j',accountId:'a',title:'客服专员（虚构）',city:'晋中榆次',salary:'未确认',status:'TEST_ACTIVE'}];
store.state.rules=[{jobId:'j',facts:'工作地点是晋中榆次，职责是电话和在线解答客户问题、登记工单；薪资未确认。',faq:'',questions:'',skills:''}];
store.state.candidates=[{id:'c',accountId:'a',jobId:'j',name:'虚构求职者',source:'platform',platformUserId:'fixture-user',platformSessionId:'fixture-session',platformPeerPartnerId:'fixture-peer',resume:'有客户服务经历',message:'旧摘要，不应当作当前问题',draft:'',mode:'draft',updatedAt:new Date(clock).toISOString()}];
store.state.settings.aiProvider='codex';store.setSecret('account:a','fixture-only');
let finish=()=>{};
const completed=new Promise<void>(resolve=>{finish=resolve;});
const runner=new AutoReplyRunner(store,connector,()=>{store.save();if(store.state.replyAttempts.some(a=>a.status==='drafted'||a.status==='failed'))finish();},new Set(),{now:()=>clock});
let timeout:ReturnType<typeof setTimeout>|undefined;
try{
 await runner.action('c','enableDraft');
 clock+=90_001;
 history=[...history,{id:'fresh-incoming-1',text:'请问工作地点在哪里？',kind:'text',at:new Date(clock-1).toISOString(),senderId:'fixture-peer',direction:'incoming'},{id:'fresh-incoming-2',text:'工作内容是什么？',kind:'text',at:new Date(clock).toISOString(),senderId:'fixture-peer',direction:'incoming'}];
 runner.start();
 await Promise.race([completed,new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new TypeError('自动草稿验证超时')),180000);})]);
 const attempt=store.state.replyAttempts[0];
 if(!attempt||attempt.status!=='drafted'||!attempt.text.includes('晋中')||sendCalls!==0)throw new TypeError('自动草稿验收未通过');
 clock+=90_001;await runner.tick();
 if(store.state.replyAttempts.length!==1)throw new TypeError('重复消息产生重复草稿');
 const result={at:new Date().toISOString(),fixturePlatform:true,realCodex:true,timerTriggered:true,coalescedMessages:attempt.inboundIds?.length??1,duplicateDrafts:0,platformSendCalls:sendCalls,status:attempt.status,text:attempt.text};
 await writeFile('evidence/auto-reply-real-codex.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}finally{if(timeout)clearTimeout(timeout);runner.stop();store.close();await rm(directory,{recursive:true,force:true});}
