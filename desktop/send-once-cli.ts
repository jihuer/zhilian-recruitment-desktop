import {readFile,writeFile} from 'node:fs/promises';
import type {Store} from './store';
import {ZhilianConnector,ConnectorError} from './connector';
import {SendOnceSchema,sendOnce} from './send-once';

export async function runSendOnceCli(store:Store,requestPath:string,receiptPath:string):Promise<void>{
 const connector=new ZhilianConnector();
 try{
  const raw=await readFile(requestPath,'utf8');if(Buffer.byteLength(raw)>16000)throw new TypeError('请求过大');
  const input=SendOnceSchema.parse(JSON.parse(raw));
  const candidates=store.state.candidates.filter(c=>c.name===input.candidateName&&c.source==='platform');
  if(candidates.length!==1)throw new TypeError('接收人不唯一，已停止');
  const candidate=candidates[0];const account=store.state.accounts.find(a=>a.id===candidate?.accountId);
  if(!account)throw new TypeError('账号不存在');const session=store.secret('account:'+account.id);if(!session)throw new TypeError('未连接账号');
  const jobs=await connector.listJobs(session,account.id);store.setSecret('account:'+account.id,jobs.session);
  store.state.jobs=[...store.state.jobs.filter(j=>j.accountId!==account.id),...jobs.jobs];account.status='connected';account.lastSync=new Date().toISOString();store.save();
  const result=await sendOnce(store,connector,input);
  await writeFile(receiptPath,JSON.stringify({at:new Date().toISOString(),...result},null,2),{mode:0o600});
  console.log(JSON.stringify(result));
 }catch(error){
  const reason=error instanceof ConnectorError||error instanceof TypeError?error.message:'单次发送未完成，请核对账本，禁止换编号重试';
  await writeFile(receiptPath,JSON.stringify({at:new Date().toISOString(),status:'error',reason},null,2),{mode:0o600});console.log(JSON.stringify({status:'error',reason}));
 }finally{await connector.dispose();}
}
