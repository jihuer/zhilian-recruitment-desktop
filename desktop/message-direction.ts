import type { APIRequestContext } from 'playwright';
import { z } from 'zod';
import type { HistoryMessage } from './history-data';
import { ConnectorError,readEnvelope } from './connector-data';

export function withMessageDirections(messages:readonly HistoryMessage[],staffId:string,peerId:string|undefined):HistoryMessage[]{
 return messages.map(message=>({...message,direction:staffId===peerId?'unknown':message.senderId===staffId?'outgoing':peerId&&message.senderId===peerId?'incoming':'unknown'}));
}
export async function readMessagingStaffId(context:APIRequestContext):Promise<string>{
 const response=await context.get('https://rd6.zhaopin.com/api/session',{headers:{'y-zp-business-type':'B'},maxRedirects:0});
 try{
  if(response.status()===401)throw new ConnectorError('expired','智联登录已失效，请重新连接。');
  if(!response.ok())throw new ConnectorError('platform','无法核对消息发送者身份，请稍后重试。');
  const id=z.union([z.string().min(1),z.number().finite()]).transform(String);
  const data=z.object({staff:z.object({staffId:id})}).safeParse(readEnvelope(await response.json()));
  if(!data.success)throw new ConnectorError('format','当前招聘者消息身份无法确认。');
  return data.data.staff.staffId;
 }finally{await response.dispose();}
}
