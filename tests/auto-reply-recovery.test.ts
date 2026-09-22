import {expect,test} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,initialState} from '../desktop/store';
import {StateSchema} from '../shared/contracts';
import {parseHistory} from '../desktop/history-data';

test('legacy state gains empty automatic reply records without enabling',()=>{
 const {autoReplies,replyAttempts,...legacy}=initialState();
 expect(StateSchema.parse(legacy).autoReplies).toEqual([]);
 expect(StateSchema.parse(legacy).replyAttempts).toEqual([]);
 expect(autoReplies).toEqual([]);expect(replyAttempts).toEqual([]);
});
test('history retains client send identifier alongside server identifier',()=>{
 const result=parseHistory({code:200,data:{messages:[{idServer:'server',sendMessageId:'client',from:'self',type:'text',text:'fixture',time:1700000000000}]}});
 expect(result[0]?.id).toBe('server');expect(result[0]?.clientMessageId).toBe('client');
});
test('restart never resumes automatic sending and retains uncertain attempts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'autoreply-recovery-'));
 const cipher={encrypt:(text:string)=>text,decrypt:(text:string)=>text};
 let store=await Store.open(dir,cipher);
 try{
  store.state.autoReplies=[{candidateId:'fixture',mode:'send',status:'enabled',startedAt:'',nextCheckAt:'',lastMessageId:'old',reason:''}];
  store.state.replyAttempts=(['generating','sending','accepted'] as const).map((status,index)=>({id:String(index),candidateId:'fixture',inboundId:'incoming-'+index,status,text:'fixture',createdAt:'',updatedAt:'',reason:''}));
  store.close();store=await Store.open(dir,cipher);
  expect(store.state.autoReplies[0]?.status).toBe('paused');
  expect(store.state.replyAttempts.map(a=>a.status)).toEqual(['discarded','uncertain','uncertain']);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
