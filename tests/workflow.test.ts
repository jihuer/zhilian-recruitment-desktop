import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../desktop/store';
import { TaskRunner } from '../desktop/tasks';
import { generateDraft } from '../desktop/ai';
import { z } from 'zod';
import { Service } from '../desktop/service';

const directories:string[]=[];
const cipher={encrypt:(s:string)=>Buffer.from(s).toString('base64'),decrypt:(s:string)=>Buffer.from(s,'base64').toString()};
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'recruitment-test-'));directories.push(dir);
 const store=await Store.open(dir,cipher);
 store.state.accounts.push({id:'a',name:'测试',company:'测试',source:'智联招聘',status:'connected',lastSync:''});
 store.state.jobs.push({id:'a:j',accountId:'a',title:'测试岗位',city:'测试',salary:'未提供',status:'测试'});
 for(const id of ['one','two'])store.state.candidates.push({id,accountId:'a',jobId:'a:j',name:'测试资料',resume:'具备 Excel 经验',message:'',draft:'',mode:'draft',updatedAt:''});
 const runner=new TaskRunner(store,()=>store.save());
 const input={accountId:'a',jobId:'a:j',templateId:'initial',intervalMinutes:5,limit:2,skills:'Excel',city:'',mode:'draft' as const};
 return {store,runner,input,dir};
}
test('外发、跨账号岗位和双任务在后端被阻断',async()=>{
 const {store,runner,input}=await fixture();
 expect(()=>runner.create({...input,mode:'send'})).toThrow('尚未通过');
 expect(()=>runner.create({...input,jobId:'b:j'})).toThrow('不属于');
 runner.create(input);expect(()=>runner.create(input)).toThrow('未结束');
 runner.stop();store.close();
});
test('暂停和人工接管阻止草稿，模板快照不被后续修改污染',async()=>{
 const {store,runner,input}=await fixture();runner.create(input);
 const task=store.state.tasks[0];if(!task)throw new TypeError('missing task');
 runner.action(task.id,'pause');runner.tick();expect(task.processed).toBe(0);
 runner.action(task.id,'resume');
 const template=store.state.templates[0];if(template)template.text='changed';
 const first=store.state.candidates[0];if(first)first.mode='human';
 runner.tick();expect(task.skipped).toBe(1);expect(first?.draft).toBe('');
 task.nextAt=new Date(0).toISOString();runner.tick();
 expect(store.state.candidates[1]?.draft).toContain('测试岗位');expect(task.sent).toBe(0);expect(task.status).toBe('completed');
 runner.stop();store.close();
});
test('SQLite保存与重启恢复，运行任务不会自动继续，凭证不进入公开状态',async()=>{
 const {store,runner,input,dir}=await fixture();runner.create(input);store.setSecret('account:a','secret-example');store.save();store.close();
 const restored=await Store.open(dir,cipher);
  expect(restored.state.tasks[0]?.status).toBe('paused');expect(restored.secret('account:a')).toBe('secret-example');
 expect(restored.state.accounts[0]?.status).toBe('unverified');
 expect(JSON.stringify(restored.state)).not.toContain('secret-example');
 expect(readFileSync(join(dir,'workbench.sqlite')).includes(Buffer.from('secret-example'))).toBe(false);
 restored.close();
});
test('AI协议使用本机测试服务完成草稿请求并解析，非真实模型质量验证',async()=>{
 const {store}=await fixture();
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async req=>{
  const body=z.object({model:z.string(),messages:z.array(z.object({role:z.string()}))}).parse(await req.json());expect(body.model).toBe('fixture-model');expect(body.messages[0]?.role).toBe('system');
  return Response.json({choices:[{message:{content:'测试草稿：请问何时方便沟通？'}}]});
 }});
 try{
  const candidate=store.state.candidates[0],job=store.state.jobs[0];if(!candidate||!job)throw new TypeError('fixture');
  const result=await generateDraft({candidate,job,rule:undefined,settings:{...store.state.settings,aiBaseUrl:`http://127.0.0.1:${server.port}/v1`,aiModel:'fixture-model'},key:null});
  expect(result).toBe('测试草稿：请问何时方便沟通？');
 }finally{server.stop(true);store.close();}
});
test('更换模型服务域名不会携带旧密钥，IPC不能指定任意Chrome程序',async()=>{
 const {store}=await fixture();const service=new Service(store,()=>{});
 try{
  const settings={chromePath:'',aiBaseUrl:'https://first.example/v1',aiModel:'model',apiKey:'test-secret'};
  expect((await service.invoke({type:'saveSettings',value:settings})).ok).toBe(true);
  expect(store.secret('ai-key')).toBe('test-secret');
  expect((await service.invoke({type:'saveSettings',value:{...settings,aiBaseUrl:'https://second.example/v1',apiKey:''}})).ok).toBe(true);
  expect(store.secret('ai-key')).toBe(null);
  expect((await service.invoke({type:'saveSettings',value:{...settings,chromePath:'/bin/sh'}})).ok).toBe(false);
 }finally{await service.close();}
});
test('平台摘要未关联岗位仍可人工接管，不能伪造来源或改写同步内容',async()=>{
 const {store}=await fixture();const service=new Service(store,()=>{});
 const item={id:'a:session:test',accountId:'a',jobId:'',name:'测试平台资料',resume:'',message:'同步的原始摘要',draft:'',mode:'draft' as const,updatedAt:'',source:'platform' as const,platformSessionId:'test'};
 store.state.candidates.push(item);
 try{
  const result=await service.invoke({type:'saveCandidate',value:{...item,mode:'human',message:'伪造的摘要',name:'改写名称'}});
  expect(result.ok).toBe(true);
  expect(store.state.candidates.find(c=>c.id===item.id)?.message).toBe('同步的原始摘要');
  expect(store.state.candidates.find(c=>c.id===item.id)?.mode).toBe('human');
  expect((await service.invoke({type:'saveCandidate',value:{...item,id:'forged'}})).ok).toBe(false);
 }finally{await service.close();}
});
