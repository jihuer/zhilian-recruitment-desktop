import { get } from 'node:https';
import { isIP } from 'node:net';
import { inflateRawSync } from 'node:zlib';
import { Open } from 'unzipper';

const maxBytes=20*1024*1024;
const timeoutMs=30_000;
export type AttachmentResponse={
 readonly statusCode:number;
 readonly contentLength:string|undefined;
 readonly body:AsyncIterable<Uint8Array>;
 readonly dispose:()=>void;
};
export type AttachmentTransport=(url:URL,signal:AbortSignal)=>Promise<AttachmentResponse>;
export type AttachmentFile={readonly buffer:Buffer;readonly extension:'.pdf'|'.doc'|'.docx';readonly filename:string};
export type AttachmentInput={readonly url:string;readonly allowedHosts:readonly string[];readonly filename:string};

export function validateAttachmentUrl(value:string,allowedHosts:readonly string[]):URL{
 let url:URL;
 try{url=new URL(value);}catch(error){if(error instanceof TypeError)throw new TypeError('附件地址格式不正确');throw error;}
 const hostname=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||url.hash)throw new TypeError('附件必须使用无账号信息的 HTTPS 默认端口地址');
 if(isIP(hostname.replace(/^\[|\]$/g,''))||hostname==='localhost'||!allowedHosts.some(host=>host===host.toLowerCase()&&/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)&&host===hostname))throw new TypeError('附件主机尚未批准');
 return url;
}
export async function inspectAttachmentFile(buffer:Buffer,inputName:string):Promise<Pick<AttachmentFile,'extension'|'filename'>>{
 let filename=inputName.split(/[/\\]/).pop()?.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,'_').replace(/^[.\s]+|[.\s]+$/g,'')??'';
 if(!filename.includes('.')){
  const inferred=buffer.subarray(0,5).equals(Buffer.from('%PDF-'))?'.pdf':buffer.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'))?'.doc':buffer.subarray(0,4).equals(Buffer.from('504b0304','hex'))?'.docx':undefined;
  if(!inferred)throw new TypeError('无法识别附件文件类型');
  filename=(filename||'附件简历')+inferred;
 }
 const extension=filename.toLowerCase().endsWith('.pdf')?'.pdf':filename.toLowerCase().endsWith('.doc')?'.doc':filename.toLowerCase().endsWith('.docx')?'.docx':undefined;
 if(!extension)throw new TypeError('当前仅支持 PDF、DOC 和 DOCX 附件');
 if(extension==='.docx')await inspectDocx(buffer);
 const valid=extension==='.docx'||(extension==='.pdf'?buffer.subarray(0,5).equals(Buffer.from('%PDF-')):buffer.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')));
 if(!valid)throw new TypeError('附件内容与文件类型不一致，已停止保存');
 const stem=Array.from(filename.slice(0,-extension.length)).slice(0,120).join('');
 filename=(stem||'附件')+extension;
 if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename))filename='附件_'+filename;
 return {extension,filename};
}
async function inspectDocx(buffer:Buffer):Promise<void>{
 if(!buffer.subarray(0,4).equals(Buffer.from('504b0304','hex')))throw new TypeError('DOCX 缺少 ZIP 文件标识');
 const directory=await Open.buffer(buffer);
 if(directory.files.length>2048)throw new TypeError('DOCX 文件目录超过安全上限');
 const names=new Set<string>();
 for(const file of directory.files){
  if(names.has(file.path)||file.path.startsWith('/')||file.path.includes('\\')||file.path.split('/').includes('..')||file.flags&1||/vbaProject\.bin$/i.test(file.path))throw new TypeError('DOCX 包含重复、异常、加密或宏文件');
  names.add(file.path);
 }
 const content=directory.files.find(file=>file.path==='[Content_Types].xml');
 const document=directory.files.find(file=>file.path==='word/document.xml');
 if(!content||!document||document.type!=='File'||!document.uncompressedSize||content.type!=='File'||content.uncompressedSize>65536||content.compressedSize>65536)throw new TypeError('DOCX 缺少正文或内容类型信息过大');
 const offset=content.offsetToLocalFileHeader;
 if(offset<0||offset+30>buffer.length||buffer.readUInt32LE(offset)!==0x04034b50)throw new TypeError('DOCX 内容类型目录无效');
 const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28);
 if(start+content.compressedSize>buffer.length)throw new TypeError('DOCX 内容类型文件不完整');
 const compressed=buffer.subarray(start,start+content.compressedSize);
 if(![0,8].includes(content.compressionMethod))throw new TypeError('DOCX 使用了不支持的压缩方式');
 const xmlBytes=content.compressionMethod===8?inflateRawSync(compressed,{maxOutputLength:65536}):compressed;
 if(xmlBytes.length!==content.uncompressedSize)throw new TypeError('DOCX 内容类型长度不匹配');
 const xml=xmlBytes.toString('utf8');
 if(/<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject/i.test(xml))throw new TypeError('不支持含宏或外部实体的 DOCX');
 const overrides=xml.match(/<Override\s+[^>]*>/g)??[];
 const mainType='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
 const valid=overrides.some(tag=>{
  const part=/\bPartName\s*=\s*(["'])(.*?)\1/.exec(tag)?.[2];
  const type=/\bContentType\s*=\s*(["'])(.*?)\1/.exec(tag)?.[2];
  return part==='/word/document.xml'&&type===mainType;
 });
 if(!valid)throw new TypeError('ZIP 内容不是非宏 Word DOCX 文档');
}
const httpsTransport:AttachmentTransport=(url,signal)=>new Promise((resolve,reject)=>{
 const request=get(url,{signal,headers:{Accept:'application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/octet-stream'}},response=>{
  resolve({statusCode:response.statusCode??0,contentLength:response.headers['content-length'],body:response,dispose:()=>response.destroy()});
 });
 request.once('error',reject);
});
export async function downloadAttachment(input:AttachmentInput,transport:AttachmentTransport=httpsTransport):Promise<AttachmentFile>{
 const url=validateAttachmentUrl(input.url,input.allowedHosts);
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new TypeError('附件下载超过30秒，已停止'));},timeoutMs);});
 const receive=async():Promise<AttachmentFile>=>{
  const response=await transport(url,controller.signal);
  try{
   if(controller.signal.aborted)throw new TypeError('附件下载已停止');
   if(response.statusCode<200||response.statusCode>=300)throw new TypeError(`附件下载失败（HTTP ${response.statusCode}），不会跟随重定向`);
   const size=response.contentLength;
   if(size!==undefined&&(!/^\d+$/.test(size)||!Number.isSafeInteger(Number(size))||Number(size)>maxBytes))throw new TypeError('附件长度无效或超过20MiB');
   const chunks:Buffer[]=[];let bytes=0;
   for await(const chunk of response.body){
    if(controller.signal.aborted)throw new TypeError('附件下载已停止');
    bytes+=chunk.byteLength;if(bytes>maxBytes)throw new TypeError('附件超过20MiB，已停止下载');
    chunks.push(Buffer.from(chunk));
   }
   if(!bytes||(size!==undefined&&bytes!==Number(size)))throw new TypeError('附件为空或下载不完整');
   const buffer=Buffer.concat(chunks,bytes);
   return {buffer,...await inspectAttachmentFile(buffer,input.filename)};
  }finally{response.dispose();}
 };
 try{return await Promise.race([receive(),expired]);}
 catch(error){if(error instanceof TypeError)throw error;throw new TypeError('附件下载失败，请检查连接和附件权限');}
 finally{if(timer)clearTimeout(timer);controller.abort();}
}
