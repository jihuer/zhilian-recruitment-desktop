import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../desktop/store';
import { Service } from '../desktop/service';
import { ConnectorError, ZhilianConnector } from '../desktop/connector';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'service-boundary-'));
 const store=await Store.open(directory,{encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>Buffer.from(s,'base64').toString()});
 for(const id of ['a','b']){
  store.state.accounts.push({id,name:id,company:id,source:'智联招聘',status:'connected',lastSync:''});
  store.state.jobs.push({id:`${id}:j`,accountId:id,title:`岗位${id}`,city:'',salary:'',status:'招聘中'});
  store.state.candidates.push({id:`${id}:c`,accountId:id,jobId:`${id}:j`,name:id,resume:'岗位相关经验',message:'方便沟通吗',draft:'原草稿',mode:'draft',updatedAt:'original'});
  store.setSecret(`account:${id}`,`fixture-session-${id}`);
 }
 const service=new Service(store,()=>{});
 let closed=false;
 const close=async()=>{if(!closed){closed=true;await service.close();}};
 cleanups.push(async()=>{await close();rmSync(directory,{recursive:true,force:true});});
 return {store,service,directory,close,input:{accountId:'a',jobId:'a:j',templateId:'initial',intervalMinutes:5,limit:1,skills:'',city:'',mode:'draft' as const}};
}
for(const mode of ['edit','human'] as const){
 test(`本机延迟 HTTP 模型完成前${mode}会丢弃过期草稿`,async()=>{
  const {store,service}=await fixture();
  const entered=Promise.withResolvers<void>();const release=Promise.withResolvers<void>();
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async()=>{entered.resolve();await release.promise;return Response.json({choices:[{message:{content:'过期结果'}}]});}});
  try{
   expect((await service.invoke({type:'saveSettings',value:{chromePath:'',aiProvider:'api',aiBaseUrl:`http://127.0.0.1:${server.port}/v1`,aiModel:'fixture-model',apiKey:''}})).ok).toBe(true);
   const pending=service.invoke({type:'generateDraft',id:'a:c'});await entered.promise;
   const candidate=store.state.candidates.find(c=>c.id==='a:c');if(!candidate)throw new TypeError('fixture');
   expect((await service.invoke({type:'saveCandidate',value:{...candidate,resume:'更新后的资料',mode:mode==='human'?'human':'draft'}})).ok).toBe(true);
   release.resolve();const result=await pending;
   expect(result.ok).toBe(false);
   expect(store.state.candidates.find(c=>c.id==='a:c')?.draft).toBe('原草稿');
   expect(store.state.candidates.find(c=>c.id==='b:c')?.draft).toBe('原草稿');
  }finally{release.resolve();server.stop(true);}
 });
}
test('断开账号清除凭证并阻断同步和任务恢复，另一个账号保持完整',async()=>{
 const {store,service,input}=await fixture();service.tasks.create(input);
 const task=store.state.tasks[0];if(!task)throw new TypeError('fixture');
 const untouched=JSON.stringify({account:store.state.accounts[1],job:store.state.jobs[1],candidate:store.state.candidates[1]});
 expect((await service.invoke({type:'disconnect',id:'a'})).ok).toBe(true);
 expect(store.secret('account:a')).toBe(null);expect(store.secret('account:b')).toBe('fixture-session-b');
 expect(task.status).toBe('stopped');
 expect((await service.invoke({type:'syncJobs',id:'a'})).ok).toBe(false);
 expect((await service.invoke({type:'syncConversations',id:'a'})).ok).toBe(false);
 expect((await service.invoke({type:'taskAction',id:task.id,action:'resume'})).ok).toBe(false);
 expect(JSON.stringify({account:store.state.accounts[1],job:store.state.jobs[1],candidate:store.state.candidates[1]})).toBe(untouched);
});
test('模拟平台登录过期暂停任务，保留现有岗位资料和另一账号',async()=>{
 const {store,service,input}=await fixture();service.tasks.create(input);
 const before=JSON.stringify({jobs:store.state.jobs,candidates:store.state.candidates});
 const stub=spyOn(ZhilianConnector.prototype,'listJobs').mockRejectedValue(new ConnectorError('expired','测试登录过期'));
 try{
  expect((await service.invoke({type:'syncJobs',id:'a'})).ok).toBe(false);
  expect(store.state.accounts.find(a=>a.id==='a')?.status).toBe('expired');
  expect(store.state.accounts.find(a=>a.id==='b')?.status).toBe('connected');
  expect(store.state.tasks[0]?.status).toBe('paused');
  expect(JSON.stringify({jobs:store.state.jobs,candidates:store.state.candidates})).toBe(before);
  expect((await service.invoke({type:'taskAction',id:store.state.tasks[0]?.id??'',action:'resume'})).ok).toBe(false);
 }finally{stub.mockRestore();}
});
test('模拟同一远端岗位编号同步时按账号隔离且不覆盖另一个账号',async()=>{
 const {store,service}=await fixture();
 const stub=spyOn(ZhilianConnector.prototype,'listJobs').mockImplementation(async(session,accountId)=>({session,jobs:[{id:`${accountId}:j`,accountId,title:'刷新岗位',city:'',salary:'',status:'招聘中'}]}));
 try{
  expect((await service.invoke({type:'syncJobs',id:'a'})).ok).toBe(true);
  expect(store.state.jobs.find(j=>j.id==='a:j')?.title).toBe('刷新岗位');
  expect(store.state.jobs.find(j=>j.id==='b:j')?.title).toBe('岗位b');
  expect(store.state.jobs).toHaveLength(2);
 }finally{stub.mockRestore();}
});

test('关闭开始后拒绝新命令且不改写状态',async()=>{
 const {store,service,close}=await fixture();
 const release=Promise.withResolvers<void>();
 const stub=spyOn(ZhilianConnector.prototype,'dispose').mockImplementation(()=>release.promise);
 const closing=close();
 try{
  const before=JSON.stringify(store.state.templates);
  const result=await service.invoke({type:'saveTemplate',value:{id:'after-close',name:'关闭后',text:'不应写入'}});
  expect(result.ok).toBe(false);expect(JSON.stringify(store.state.templates)).toBe(before);
 }finally{release.resolve();await closing;stub.mockRestore();}
});
for(const failure of ['history-expired','identity-expired','identity-mismatch'] as const){
 test(`${failure}停止该账号正在运行的任务`,async()=>{
  const {store,service,input}=await fixture();service.tasks.create(input);
  const candidate=store.state.candidates[0],account=store.state.accounts[0];if(!candidate||!account)throw new TypeError('fixture');
  candidate.source='platform';candidate.platformUserId='fixture-user';account.platformIdentity='original-identity';
  const history=spyOn(ZhilianConnector.prototype,'readHistory').mockRejectedValue(new ConnectorError('expired','测试过期'));
  const identity=spyOn(ZhilianConnector.prototype,'readIdentity').mockImplementation(async()=>{
   if(failure==='identity-expired')throw new ConnectorError('expired','测试过期');
   return {session:'fixture-session-a',identity:'changed-identity'};
  });
  try{
   const result=await service.invoke(failure==='history-expired'?{type:'loadHistory',id:candidate.id,older:false}:{type:'verifyIdentity',id:account.id});
   expect(result.ok).toBe(false);expect(account.status).toBe('expired');
   expect(store.state.tasks[0]?.status).toBe('paused');expect(store.state.tasks[0]?.processed).toBe(0);
   expect(store.state.accounts[1]?.status).toBe('connected');
  }finally{history.mockRestore();identity.mockRestore();}
 });
}
test('历史加载合并去重并持久化，保留并发人工编辑',async()=>{
 const {store,service,close,directory}=await fixture();
 const candidate=store.state.candidates[0];if(!candidate)throw new TypeError('fixture');
 candidate.source='platform';candidate.platformUserId='fixture-user';
 const message={id:'one',text:'第一条',senderId:'fixture-user',at:'2026-01-01T00:00:00.000Z',kind:'text'};
 candidate.history=[message];
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
 const history=spyOn(ZhilianConnector.prototype,'readHistory').mockImplementation(async()=>{
  entered.resolve();await release.promise;return {session:'fixture-session-a',messages:[message,{...message,id:'two',at:'2026-01-02T00:00:00.000Z'}]};
 });
 try{
  const pending=service.invoke({type:'loadHistory',id:candidate.id,older:false});await entered.promise;
  expect((await service.invoke({type:'saveCandidate',value:{...candidate,resume:'并发修改',mode:'human'}})).ok).toBe(true);
  release.resolve();expect((await pending).ok).toBe(true);
  const current=store.state.candidates.find(c=>c.id===candidate.id);
  expect(current?.history?.map(item=>item.id)).toEqual(['one','two']);
  expect(current?.resume).toBe('并发修改');expect(current?.mode).toBe('human');expect(current?.draft).toBe('');
  await close();
  const reopened=await Store.open(directory,{encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>Buffer.from(s,'base64').toString()});
  try{expect(reopened.state.candidates.find(c=>c.id===candidate.id)?.history?.map(item=>item.id)).toEqual(['one','two']);}finally{reopened.close();}
 }finally{release.resolve();history.mockRestore();}
});
test('模型生成中读取到新历史会丢弃旧上下文结果',async()=>{
 const {store,service}=await fixture();const candidate=store.state.candidates[0];if(!candidate)throw new TypeError('fixture');
 candidate.source='platform';candidate.platformUserId='fixture-user';
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async()=>{entered.resolve();await release.promise;return Response.json({choices:[{message:{content:'旧上下文的结果'}}]});}});
 const history=spyOn(ZhilianConnector.prototype,'readHistory').mockResolvedValue({session:'fixture-session-a',messages:[{id:'new',text:'新信息',senderId:'fixture-user',kind:'text',at:'2026-01-01T00:00:00.000Z'}]});
 try{
  await service.invoke({type:'saveSettings',value:{chromePath:'',aiProvider:'api',aiBaseUrl:`http://127.0.0.1:${server.port}/v1`,aiModel:'fixture-model',apiKey:''}});
  const pending=service.invoke({type:'generateDraft',id:candidate.id});await entered.promise;
  expect((await service.invoke({type:'loadHistory',id:candidate.id,older:false})).ok).toBe(true);
  release.resolve();expect((await pending).ok).toBe(false);expect(candidate.draft).toBe('');
 }finally{release.resolve();server.stop(true);history.mockRestore();}
});

test('缺少简历定位信息时不会调用平台连接器',async()=>{
 const {store,service}=await fixture();const candidate=store.state.candidates[0];if(!candidate)throw new TypeError('fixture');
 candidate.source='platform';
 const read=spyOn(ZhilianConnector.prototype,'readResume').mockResolvedValue({session:'fixture-session-a',text:'不应读取'});
 try{expect((await service.invoke({type:'loadResume',id:candidate.id})).ok).toBe(false);expect(read).not.toHaveBeenCalled();}
 finally{read.mockRestore();}
});
test('平台简历保存在独立字段并清空旧草稿，保留手工资料',async()=>{
 const {store,service}=await fixture();const candidate=store.state.candidates[0];if(!candidate)throw new TypeError('fixture');
 Object.assign(candidate,{source:'platform',platformResumeNumber:'resume-a',platformResumeLanguage:'1'});
 const original=candidate.resume;
 const read=spyOn(ZhilianConnector.prototype,'readResume').mockResolvedValue({session:'fixture-session-a',text:'平台可见简历'});
 try{
  expect((await service.invoke({type:'loadResume',id:candidate.id})).ok).toBe(true);
  expect(candidate.resume).toBe(original);expect(candidate.platformResumeText).toBe('平台可见简历');expect(candidate.draft).toBe('');
  expect(candidate.platformResumeFetchedAt).toBeDefined();
 }finally{read.mockRestore();}
});
test('简历读取期间定位关联变化会丢弃旧结果',async()=>{
 const {store,service}=await fixture();const candidate=store.state.candidates[0];if(!candidate)throw new TypeError('fixture');
 Object.assign(candidate,{source:'platform',platformResumeNumber:'resume-a',platformResumeLanguage:'1'});
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
 const read=spyOn(ZhilianConnector.prototype,'readResume').mockImplementation(async()=>{entered.resolve();await release.promise;return {session:'fixture-session-a',text:'旧关联简历'};});
 try{
  const pending=service.invoke({type:'loadResume',id:candidate.id});await entered.promise;
  store.state.candidates=store.state.candidates.map(c=>c.id===candidate.id?{...c,platformResumeNumber:'resume-b'}:c);
  release.resolve();expect((await pending).ok).toBe(false);
  expect(store.state.candidates.find(c=>c.id===candidate.id)?.platformResumeText).toBeUndefined();
 }finally{release.resolve();read.mockRestore();}
});
for(const locator of ['changed','missing'] as const){
 test(`会话同步定位${locator}会清除已读取的平台简历与旧草稿`,async()=>{
  const {store,service}=await fixture();const candidate=store.state.candidates[0];if(!candidate)throw new TypeError('fixture');
  Object.assign(candidate,{source:'platform',platformResumeNumber:'resume-a',platformResumeLanguage:'1',platformResumeText:'旧平台简历',platformResumeFetchedAt:'2026-01-01T00:00:00.000Z',platformUpdatedAt:''});
  const read=spyOn(ZhilianConnector.prototype,'listConversations').mockResolvedValue({session:'fixture-session-a',conversations:[{id:candidate.id,platformSessionId:'session-a',name:candidate.name,message:candidate.message,platformUpdatedAt:'',platformJobTitle:'',unreadCount:0,...(locator==='changed'?{platformResumeNumber:'resume-b',platformResumeLanguage:'1'}:{})}]});
  try{
   expect((await service.invoke({type:'syncConversations',id:'a'})).ok).toBe(true);
   const current=store.state.candidates.find(c=>c.id===candidate.id);
   expect(current?.platformResumeText).toBeUndefined();expect(current?.platformResumeFetchedAt).toBeUndefined();expect(current?.draft).toBe('');expect(current?.resume).toBe(candidate.resume);
   expect(current?.platformResumeNumber).toBe(locator==='changed'?'resume-b':undefined);
  }finally{read.mockRestore();}
 });
}
