import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StateSchema } from '../shared/contracts';
import type { State } from '../shared/contracts';

export type Cipher={readonly encrypt:(value:string)=>string;readonly decrypt:(value:string)=>string};
export function initialState():State {
 return {knowledge:[], localModel:{phase:'idle',message:'尚未安装本地模型',progress:0,model:''},modelTest:{status:'idle',message:'',answer:'',at:'',sources:[]}, autoReplies:[],replyAttempts:[],accounts:[],jobs:[],candidates:[],rules:[],tasks:[],events:[],templates:[{id:'initial',name:'通用岗位介绍',text:'你好，我们正在招聘{岗位}，想了解你近期是否考虑新的工作机会？'}],settings:{chromePath:'',aiBaseUrl:'https://api.openai.com/v1',aiModel:'',hasApiKey:false},connection:{phase:'idle',message:''},capabilities:{jobs:true,conversations:false,greeting:false,reply:true}};
}

export class Store {
 private constructor(private readonly db:Database,private readonly path:string,private readonly cipher:Cipher,public state:State) {}
 static async open(directory:string,cipher:Cipher):Promise<Store>{
  mkdirSync(directory,{recursive:true,mode:0o700});
  const path=join(directory,'workbench.sqlite');
  const SQL=await initSqlJs({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')});
  const db=new SQL.Database(existsSync(path)?readFileSync(path):undefined);
  db.run('CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const result=db.exec("SELECT value FROM records WHERE key='state'")[0]?.values[0]?.[0];
  const state=typeof result==='string'?StateSchema.parse(JSON.parse(cipher.decrypt(result))):initialState();
  state.connection={phase:'idle',message:''};if(state.localModel.phase==='installing')state.localModel={...state.localModel,phase:'idle',message:'上次安装已中断，可重新安装继续下载'};if(state.modelTest.status==='running')state.modelTest={...state.modelTest,status:'failed',message:'上次测试已中断，请重新测试'};state.capabilities.reply=true;
  for(const account of state.accounts)if(account.status==='connected')account.status='unverified';
  for(const config of state.autoReplies)if(config.status==='enabled'){config.status='paused';config.reason='应用已重启，请重新核验后开启';}
  for(const attempt of state.replyAttempts)if(['generating','sending','accepted'].includes(attempt.status)){attempt.status=attempt.status==='generating'?'discarded':'uncertain';attempt.reason='应用曾退出，发送状态需核对，禁止自动重发';}
  for(const task of state.tasks) if(task.status==='running'){task.status='paused';task.reason='应用已重启，请核验连接后继续';}
  const store=new Store(db,path,cipher,state);store.save();return store;
 }
 save():void{
  this.db.run('INSERT OR REPLACE INTO records(key,value) VALUES (?,?)',['state',this.cipher.encrypt(JSON.stringify(this.state))]);
  this.flush();
 }
 secret(key:string):string|null{
  const value=this.db.exec('SELECT value FROM records WHERE key='+"'"+key.replaceAll("'","''")+"'")[0]?.values[0]?.[0];
  return typeof value==='string'?this.cipher.decrypt(value):null;
 }
 setSecret(key:string,value:string|null):void{
  if(value===null)this.db.run('DELETE FROM records WHERE key=?',[key]);
  else this.db.run('INSERT OR REPLACE INTO records(key,value) VALUES (?,?)',[key,this.cipher.encrypt(value)]);
  this.flush();
 }
 event(message:string):void{
  this.state.events.unshift({id:randomUUID(),at:new Date().toISOString(),message});
  this.state.events=this.state.events.slice(0,300);
 }
 close():void{this.save();this.db.close();}
 private flush():void{const temporary=this.path+'.tmp';writeFileSync(temporary,this.db.export(),{mode:0o600});renameSync(temporary,this.path);}
}
