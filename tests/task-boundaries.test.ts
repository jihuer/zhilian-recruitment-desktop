import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../desktop/store';
import { TaskRunner } from '../desktop/tasks';

const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const close of cleanup.splice(0))close();});
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'task-boundary-'));
 const store=await Store.open(directory,{encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>Buffer.from(s,'base64').toString()});
 const runner=new TaskRunner(store,()=>{});
 cleanup.push(()=>{runner.stop();store.close();rmSync(directory,{recursive:true,force:true});});
 store.state.accounts.push({id:'a',name:'fixture',company:'fixture',source:'智联招聘',status:'connected',lastSync:''});
 const job={id:'a:j',accountId:'a',title:'岗位',city:'',salary:'',status:'招聘中'};
 store.state.jobs.push(job);
 store.state.candidates.push({id:'a:c',accountId:'a',jobId:'a:j',name:'资料',resume:'',message:'',draft:'',mode:'draft',updatedAt:''});
 return {store,runner,job,input:{accountId:'a',jobId:'a:j',templateId:'initial',intervalMinutes:5,limit:1,skills:'',city:'',mode:'draft' as const}};
}
for(const status of ['已下线','已关闭','已撤销','withdrawn','closed','offline']){
 test(`任务创建拒绝已失效岗位 ${status}`,async()=>{
  const {runner,job,input,store}=await fixture();job.status=status;
  expect(()=>runner.create(input)).toThrow();
  expect(store.state.tasks).toHaveLength(0);
 });
}
test('任务中岗位下线后在处理计数之前阻断',async()=>{
 const {runner,job,input,store}=await fixture();runner.create(input);job.status='已下线';
 runner.tick();
 expect(store.state.tasks[0]).toMatchObject({status:'blocked',processed:0,drafted:0,sent:0});
 expect(store.state.candidates[0]?.draft).toBe('');
});
test('任务中岗位被移除后在处理计数之前阻断',async()=>{
 const {runner,input,store}=await fixture();runner.create(input);store.state.jobs=[];
 runner.tick();
 expect(store.state.tasks[0]).toMatchObject({status:'blocked',processed:0,drafted:0,sent:0});
});
test('仍招聘岗位继续生成本地草稿并保持零发送',async()=>{
 const {runner,input,store}=await fixture();runner.create(input);
 runner.tick();
 expect(store.state.tasks[0]).toMatchObject({status:'completed',processed:1,drafted:1,sent:0});
 expect(store.state.candidates[0]?.draft.length).toBeGreaterThan(0);
});
for(const status of ['expired','disconnected','unverified'] as const){
 test(`运行任务遇到账户${status}会在计数前暂停`,async()=>{
  const {runner,store,input}=await fixture();runner.create(input);
  const account=store.state.accounts[0];if(!account)throw new TypeError('fixture');account.status=status;
  runner.tick();
  expect(store.state.tasks[0]).toMatchObject({status:'paused',processed:0,drafted:0,sent:0});
 });
}
for(const condition of ['missing','offline'] as const){
 test(`恢复任务拒绝${condition}岗位`,async()=>{
  const {runner,store,input,job}=await fixture();runner.create(input);
  const task=store.state.tasks[0];if(!task)throw new TypeError('fixture');runner.action(task.id,'pause');
  if(condition==='missing')store.state.jobs=[];else job.status='offline';
  expect(()=>runner.action(task.id,'resume')).toThrow();expect(task.status).toBe('paused');
 });
}
