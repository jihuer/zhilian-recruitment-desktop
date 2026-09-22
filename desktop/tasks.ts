import { randomUUID } from 'node:crypto';
import type { Candidate, Task } from '../shared/contracts';
import type { z } from 'zod';
import type { TaskInputSchema } from '../shared/contracts';
import type { Store } from './store';

function unavailableJob(status:string):boolean{
 return /下线|关闭|撤销|撤回|停止招聘|已结束|已删除|^(withdrawn|closed|offline|deleted)$/i.test(status.trim());
}

export function renderTemplate(text:string,job:string,name:string):string{
 const rendered=text.replaceAll('{岗位}',job).replaceAll('{称呼}',name||'你好');
 if(/\{[^{}]+\}/.test(rendered))throw new TypeError('话术包含未填写的变量，仅支持 {岗位} 和 {称呼}');
 return rendered;
}
export class TaskRunner {
 private timer:ReturnType<typeof setInterval>|undefined;
 constructor(private readonly store:Store,private readonly changed:()=>void){}
 start():void{this.timer=setInterval(()=>this.tick(),1000);}
 create(value:z.infer<typeof TaskInputSchema>):void{
  if(value.mode==='send')throw new TypeError('智联外发通道尚未通过接入验证，请使用草稿预演');
  const state=this.store.state;
  if(!state.accounts.some(a=>a.id===value.accountId&&a.status==='connected'))throw new TypeError('请先连接有效的智联账号');
  const job=state.jobs.find(j=>j.id===value.jobId&&j.accountId===value.accountId);
  if(!job)throw new TypeError('所选岗位不属于该账号，请刷新岗位');
  if(unavailableJob(job.status))throw new TypeError('岗位已下线或关闭，不能创建任务');
  if(state.tasks.some(t=>t.status==='running'||t.status==='paused'))throw new TypeError('已有未结束的任务，请先停止或完成该任务');
  const template=state.templates.find(t=>t.id===value.templateId);
  if(!template)throw new TypeError('请选择有效话术');
  renderTemplate(template.text,job.title,'候选人');
  if(value.city.trim())throw new TypeError('当前手工资料未提供结构化城市，不能声称城市筛选生效，请清空城市条件');
  const candidates=state.candidates.filter(c=>c.accountId===value.accountId&&c.jobId===value.jobId&&c.mode==='draft');
  if(!candidates.length)throw new TypeError('该岗位没有候选人资料，请先在智能接管中录入资料');
  const now=new Date().toISOString();
  state.tasks.unshift({...value,id:randomUUID(),status:'running',createdAt:now,processed:0,drafted:0,sent:0,skipped:0,reason:'草稿预演，仅处理本地已录入资料，不联系候选人',nextAt:now,candidateIds:candidates.map(c=>c.id),templateText:template.text});
  this.store.event('已启动草稿任务');this.changed();
 }
 action(id:string,action:'pause'|'resume'|'stop'):void{
  const task=this.store.state.tasks.find(t=>t.id===id);if(!task)throw new TypeError('任务不存在');
  if(['stopped','completed'].includes(task.status))throw new TypeError('任务已结束');
  switch(action){
   case 'pause':task.status='paused';task.reason='已手动暂停';break;
   case 'resume':{
    if(!this.store.state.accounts.some(a=>a.id===task.accountId&&a.status==='connected'))throw new TypeError('请先重新连接账号');
    const job=this.store.state.jobs.find(j=>j.id===task.jobId&&j.accountId===task.accountId);
    if(!job||unavailableJob(job.status))throw new TypeError('岗位已不存在、下线或关闭，不能恢复任务');
    task.status='running';task.nextAt=new Date().toISOString();task.reason='已继续草稿预演';break;
   }
   case 'stop':task.status='stopped';task.reason='已手动停止';break;
   default:{const unreachable:never=action;throw new TypeError(String(unreachable));}
  }this.changed();
 }
 tick():void{
  const task=this.store.state.tasks.find(t=>t.status==='running');
  if(!task||Date.parse(task.nextAt)>Date.now())return;
  if(!this.store.state.accounts.some(a=>a.id===task.accountId&&a.status==='connected')){task.status='paused';task.reason='账号未连接，请重新验证连接';this.changed();return;}
  const job=this.store.state.jobs.find(j=>j.id===task.jobId&&j.accountId===task.accountId);
  if(!job||unavailableJob(job.status)){task.status='blocked';task.reason='岗位已不存在、下线或关闭，请刷新岗位后重新创建任务';this.changed();return;}
  const id=task.candidateIds[task.processed];
  if(!id||task.drafted>=task.limit){task.status='completed';task.reason='草稿预演完成，未发送任何消息';this.changed();return;}
  const candidate=this.store.state.candidates.find(c=>c.id===id);
  task.processed++;
  const skills=task.skills.split(/[,，\n]/).map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(!candidate||candidate.mode==='human'||skills.some(skill=>!candidate.resume.toLowerCase().includes(skill))){task.skipped++;task.reason='已跳过人工接管或技能信息不足的资料';}
  else this.draft(task,candidate);
  if(task.status==='running'&&(task.processed>=task.candidateIds.length||task.drafted>=task.limit)){task.status='completed';task.reason='草稿预演完成，未发送任何消息';}
  task.nextAt=new Date(Date.now()+task.intervalMinutes*60000).toISOString();this.changed();
 }
 stop():void{if(this.timer)clearInterval(this.timer);for(const task of this.store.state.tasks)if(task.status==='running'){task.status='paused';task.reason='应用已退出';}this.store.save();}
 private draft(task:Task,candidate:Candidate):void{
  const job=this.store.state.jobs.find(j=>j.id===task.jobId&&j.accountId===task.accountId);
  if(!job){task.status='blocked';task.reason='岗位已不存在';return;}
  candidate.draft=renderTemplate(task.templateText,job.title,candidate.name);candidate.updatedAt=new Date().toISOString();task.drafted++;task.reason='已生成一份话术草稿，等待人工审核';
 }
}
