import {expect,test} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store} from '../desktop/store';import {sendOnce} from '../desktop/send-once';import type {AutoReplyConnector} from '../desktop/auto-reply-state';import type {HistoryMessage} from '../desktop/history-data';
test('explicit single message is persisted before posting and never posted twice',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'send-once-fixture-'));const store=await Store.open(directory,{encrypt:s=>s,decrypt:s=>s});
 try{
  store.state.accounts=[{id:'a',name:'fixture',status:'connected',lastSync:'',company:'fixture',source:'智联招聘'}];store.state.jobs=[{id:'j',accountId:'a',title:'销售',city:'晋中',salary:'',status:'平台状态 WITHDRAWN'}];store.state.candidates=[{id:'c',accountId:'a',name:'fixture',jobId:'',source:'platform',platformSessionId:'s',platformUserId:'u',platformPeerPartnerId:'p',platformResumeNumber:'r',platformResumeLanguage:'1',resume:'',message:'',draft:'',mode:'draft',updatedAt:''}];store.setSecret('account:a','fixture');
  let calls=0;let history:HistoryMessage[]=[];
  const connector:AutoReplyConnector={checkReplyPermission:async()=>({session:'fixture',allowed:true,reason:''}),readHistory:async()=>({session:'fixture',messages:history}),sendReply:async(_session,input,check)=>{expect(check()).toBe(true);expect(store.state.replyAttempts[0]?.status).toBe('sending');calls++;history=[{id:'server',clientMessageId:input.sendMessageId,direction:'outgoing',senderId:'self',kind:'text',text:input.content,at:new Date().toISOString()}];return {session:'fixture'};}};
  const input={candidateName:'fixture',content:'岗位已撤回',sendMessageId:'a'.repeat(32),jobTitle:'销售',jobState:'WITHDRAWN',city:'晋中'};
  expect((await sendOnce(store,connector,input)).status).toBe('confirmed');expect((await sendOnce(store,connector,input)).confirmedMatches).toBe(1);expect(calls).toBe(1);
  await expect(sendOnce(store,connector,{...input,jobState:'ACTIVE'})).rejects.toThrow('事实已变化');expect(calls).toBe(1);
 }finally{store.close();await rm(directory,{recursive:true,force:true});}
});
