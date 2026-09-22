import type { Command, State } from '../shared/contracts';
import type { Store } from './store';
import { generateDraft } from './ai';
import { retrieveKnowledge } from './knowledge';
import { LOCAL_MODEL_URL } from '../shared/local-models';
import type { LocalModelManager } from './local-models';

type TestCommand=Extract<Command,{type:'testModel'}>;
export class ModelSetup {
 private testing=false;
 private stopped=false;
 constructor(private readonly store:Store,private readonly changed:()=>void,private readonly local?:LocalModelManager){}
 readonly generate:typeof generateDraft=async input=>{
  if(input.settings.aiProvider==='local'){
   if(!this.local)throw new TypeError('请在桌面应用中安装本地模型');
   await this.local.ensureRunning();
  }
  return generateDraft(input);
 };
 install(model:string):void{
  if(!this.local)throw new TypeError('请在桌面应用中安装本地模型');
  if(this.store.state.localModel.phase==='installing')throw new TypeError('已有本地模型安装任务');
  const settings=JSON.stringify(this.store.state.settings);
  void this.local.install(model).then(()=>{
   if(this.stopped)return;
   if(JSON.stringify(this.store.state.settings)===settings){
    this.store.state.settings={...this.store.state.settings,aiProvider:'local',aiBaseUrl:LOCAL_MODEL_URL,aiModel:model};
    this.store.state.localModel={...this.store.state.localModel,message:'本地模型已安装并保存为默认模型，可以测试连接'};
   }
   this.changed();
  }).catch((error:unknown)=>{
   if(this.stopped||this.store.state.localModel.phase==='idle')return;
   this.store.state.localModel={...this.store.state.localModel,phase:'error',message:error instanceof TypeError?error.message:'本地安装未完成，请检查网络和磁盘后重试'};this.changed();
  });
 }
 cancel():void{this.local?.cancel();}
 async test(command:TestCommand):Promise<void>{
  if(this.testing)throw new TypeError('模型正在测试，请等待结果');
  this.testing=true;
  const s=this.store.state;
  s.modelTest={status:'running',message:'正在用测试问题生成回答，不会发送给候选人',answer:'',sources:[],at:new Date().toISOString()};this.changed();
  try{
   const job=command.jobId?s.jobs.find(j=>j.id===command.jobId):{id:'model-test',accountId:'model-test',title:'模型连接测试',city:'未确认',salary:'未确认',status:'TEST'};
   if(!job)throw new TypeError('请选择有效岗位');
   const settings:State['settings']={...s.settings,...command.value};
   const {apiKey}=command.value;
   const key=settings.aiProvider==='api'?(apiKey.trim()||(new URL(settings.aiBaseUrl).origin===new URL(s.settings.aiBaseUrl).origin?this.store.secret('ai-key'):null)):null;
   const sources=retrieveKnowledge(s.knowledge,{accountId:job.accountId,jobId:job.id,query:command.question});
   const answer=await this.generate({candidate:{id:'model-test',accountId:job.accountId,jobId:job.id,name:'虚构测试',resume:'',message:command.question,draft:'',mode:'draft',updatedAt:''},job,rule:s.rules.find(r=>r.jobId===job.id),settings,key,knowledge:s.knowledge});
   if(this.stopped)return;
   s.modelTest={status:'passed',message:'模型真实生成成功；请核对回答与引用资料是否一致，测试未发送消息',answer,sources:[...sources],at:new Date().toISOString()};
  }catch(error){
   if(this.stopped)return;
   s.modelTest={status:'failed',message:error instanceof TypeError?error.message:'模型连接或生成失败，请检查地址、密钥、模型名称与服务状态',answer:'',sources:[],at:new Date().toISOString()};
  }finally{this.testing=false;if(!this.stopped)this.changed();}
 }
 close():void{this.stopped=true;this.local?.close();}
}
