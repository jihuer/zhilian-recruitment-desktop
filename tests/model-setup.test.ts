import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelSetup } from '../desktop/model-setup';
import { Store } from '../desktop/store';
import { generateDraft } from '../desktop/ai';

const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'model-config-test-'));directories.push(dir);return Store.open(dir,{encrypt:text=>text,decrypt:text=>text});}
const job={id:'j',accountId:'a',title:'门店销售',city:'晋中',salary:'待确认',status:'OPEN'};
const candidate={id:'c',accountId:'a',jobId:'j',name:'虚构候选人',resume:'',message:'公司办公地址在哪里？',draft:'',mode:'draft' as const,updatedAt:''};

test('model test uses unsaved API configuration, scoped knowledge, and does not retain supplied key',async()=>{
 let body:unknown;const captured:{authorization:string|null}={authorization:null};
 const server=Bun.serve({port:0,async fetch(req){captured.authorization=req.headers.get('authorization');body=await req.json();return Response.json({choices:[{message:{content:'公司办公地址是测试路8号。'}}]});}});
 const store=await fixture();const model=new ModelSetup(store,()=>store.save());
 store.state.jobs=[job];store.state.knowledge=[{id:'k',accountId:'a',jobId:'',scope:'company',title:'公司地址',text:'公司办公地址是测试路8号。',updatedAt:''},{id:'other',accountId:'other',jobId:'',scope:'company',title:'保密',text:'公司办公地址是绝不泄露路。',updatedAt:''}];
 try{
  await model.test({type:'testModel',value:{aiProvider:'api',aiBaseUrl:`http://127.0.0.1:${server.port}/v1`,aiModel:'fixture-model',apiKey:'test-secret'},jobId:'j',question:candidate.message});
  expect(captured.authorization).toBe('Bearer test-secret');expect(store.state.modelTest.status).toBe('passed');
  expect(store.state.modelTest.sources.map(s=>s.title)).toEqual(['公司地址']);
  expect(JSON.stringify(body)).toContain('测试路8号');expect(JSON.stringify(body)).not.toContain('绝不泄露路');
  expect(store.secret('ai-key')).toBeNull();expect(store.state.settings.aiModel).toBe('');
 }finally{model.close();store.close();server.stop(true);}
});

test('changing API origin never forwards saved credential and failure remains visible',async()=>{
 const captured:{authorization:string|null}={authorization:'not called'};
 const server=Bun.serve({port:0,fetch(req){captured.authorization=req.headers.get('authorization');return new Response('denied',{status:401});}});
 const store=await fixture();const model=new ModelSetup(store,()=>store.save());store.setSecret('ai-key','existing-test-secret');
 try{
  await model.test({type:'testModel',value:{aiProvider:'api',aiBaseUrl:`http://127.0.0.1:${server.port}/v1`,aiModel:'fixture',apiKey:''},question:'你好'});
  expect(captured.authorization).toBeNull();expect(store.state.modelTest.status).toBe('failed');expect(store.state.modelTest.message).toContain('401');expect(store.state.modelTest.answer).toBe('');
 }finally{model.close();store.close();server.stop(true);}
});

test('empty model output fails instead of reporting a successful configuration',async()=>{
 const server=Bun.serve({port:0,fetch(){return Response.json({choices:[{message:{content:'  '}}]});}});
 try{await expect(generateDraft({candidate,job,rule:undefined,settings:{chromePath:'',aiProvider:'api',aiBaseUrl:`http://127.0.0.1:${server.port}/v1`,aiModel:'fixture',hasApiKey:false},key:null})).rejects.toThrow('空白');}finally{server.stop(true);}
});

test('knowledge survives store reopen and unfinished setup never appears completed',async()=>{
 const store=await fixture();const dir=directories.at(-1);if(!dir)throw new TypeError('fixture missing');
 store.state.knowledge=[{id:'k',accountId:'a',jobId:'j',scope:'job',title:'工作时间',text:'工作时间为9点到18点。',updatedAt:''}];
 store.state.localModel={phase:'installing',model:'qwen2.5:0.5b',progress:50,message:'下载中'};store.close();
 const reopened=await Store.open(dir,{encrypt:text=>text,decrypt:text=>text});
 try{expect(reopened.state.knowledge[0]?.text).toContain('9点');expect(reopened.state.localModel.phase).toBe('idle');}finally{reopened.close();}
});
