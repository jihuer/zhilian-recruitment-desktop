import { expect, test } from 'bun:test';
import { downloadAttachment, validateAttachmentUrl, inspectAttachmentFile } from '../desktop/attachment-file';
import type { AttachmentTransport } from '../desktop/attachment-file';

const allowedHosts=['files.example.test'];
const pdf=Buffer.from('%PDF-1.7\nfixture');
const options={url:'https://files.example.test/resume.pdf',allowedHosts,filename:'resume.pdf'};
for(const url of ['http://files.example.test/a','https://evil.test/a','https://files.example.test.evil.test/a','https://user:pass@files.example.test/a','https://files.example.test:444/a','https://127.0.0.1/a','https://files.example.test/a#fragment']){
 test(`拒绝未批准下载URL ${url}`,()=>{expect(()=>validateAttachmentUrl(url,allowedHosts)).toThrow();});
}
test('批准的精确HTTPS主机允许签名查询参数且不改变URL',()=>{
 const url=options.url+'?signature=fixture';expect(validateAttachmentUrl(url,allowedHosts).href).toBe(url);
});
test('PDF和DOC魔数与后缀必须一致，损坏DOCX被拒绝',async()=>{
 expect(await inspectAttachmentFile(pdf,'简历.pdf')).toEqual({extension:'.pdf',filename:'简历.pdf'});
 const doc=Buffer.from('d0cf11e0a1b11ae1','hex');expect((await inspectAttachmentFile(doc,'旧简历.doc')).extension).toBe('.doc');
 await expect(inspectAttachmentFile(pdf,'伪装.doc')).rejects.toThrow();
 await expect(inspectAttachmentFile(Buffer.from('<html>login</html>'),'简历.pdf')).rejects.toThrow();
 await expect(inspectAttachmentFile(Buffer.from('PK\x03\x04'),'简历.docx')).rejects.toThrow();
});
test('文件名去除路径、控制字符、Windows特殊字符且不形成隐藏文件',async()=>{
 const result=await inspectAttachmentFile(pdf,'../../CON:<恶意>\u0000.pdf');
 expect(result.filename).not.toMatch(/[<>:"/\\|?*\x00-\x1f]/);expect(result.filename.startsWith('.')).toBe(false);expect(result.extension).toBe('.pdf');
});
function transportFor(chunks:Buffer[],statusCode=200,contentLength?:string):AttachmentTransport{
 return async()=>({statusCode,contentLength,body:(async function*(){yield* chunks;})(),dispose:()=>{}});
}
test('注入传输读取完整原始字节且返回安全名称，不落文件',async()=>{
 const result=await downloadAttachment(options,transportFor([pdf.subarray(0,4),pdf.subarray(4)]));
 expect(result.buffer.equals(pdf)).toBe(true);expect(result.filename).toBe('resume.pdf');
});
test('注入传输不能绕过生产URL校验',async()=>{
 let called=false;const transport:AttachmentTransport=async()=>{called=true;throw new TypeError('不应调用');};
 await expect(downloadAttachment({...options,url:'http://files.example.test/a'},transport)).rejects.toThrow();expect(called).toBe(false);
});
for(const status of [302,401,404,500])test(`拒绝HTTP ${status}且释放响应`,async()=>{
 let disposed=false;
 const transport:AttachmentTransport=async()=>({...await transportFor([pdf],status)(new URL(options.url),new AbortController().signal),dispose:()=>{disposed=true;}});
 await expect(downloadAttachment(options,transport)).rejects.toThrow();expect(disposed).toBe(true);
});
test('Content-Length与实际流均限制20MiB',async()=>{
 await expect(downloadAttachment(options,transportFor([pdf],200,String(20*1024*1024+1)))).rejects.toThrow();
 await expect(downloadAttachment(options,transportFor([Buffer.alloc(20*1024*1024),Buffer.from('x')]))).rejects.toThrow();
});
test('截断或空附件不能被误判成功',async()=>{
 await expect(downloadAttachment(options,transportFor([pdf],200,String(pdf.length+1)))).rejects.toThrow();
 await expect(downloadAttachment(options,transportFor([]))).rejects.toThrow();
});

const validDocx=Buffer.from('UEsDBBQAAAAIALZWMV2sbhJangAAANwAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbF2PsQ7CMBBDf6XKitqrGBhQ24UdGPiBU3JtI5pLlBwF/p4EpA6Mlu1nubu9A6Xq5RZOvZpFwhEg6ZkcpsYH4uyMPjqULOMEAfUdJ4J92x5AexZiqaUw1NBdVorRGqquGOWMjnoFTx8NGK8fLiebTFPV6Vcry73CEBarUaxnWNn8bdZ+HK2mrV9oIXpNKVme3NJsjkPLu4KHoYPvqeEDUEsDBBQAAAAIALZWMV1fW9FMDQAAAAsAAAARAAAAd29yZC9kb2N1bWVudC54bWyzSclPLs1NzSvRtwMAUEsBAhQDFAAAAAgAtlYxXaxuElqeAAAA3AAAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACAC2VjFdX1vRTA0AAAALAAAAEQAAAAAAAAAAAAAAgAHPAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAIAAgCAAAAACwEAAAAA','base64');
const macroDocx=Buffer.from('UEsDBBQAAAAIALZWMV2ohbE1lwAAAMIAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbD2OMQ7CMAxFr1JlRY0RAwNquyBWYOACJjFtRONEiSlwexKQGK3/3/vuLu9IuXn5mXOvJpG4A8hmIo9Zh0hckltIHqWcaYSI5o4jwWa93oIJLMTSSnWooTstlJKz1JwxyRE99QqeIVmwwTx8aepiU83+h9XlXmGMszMoLjAsbLXPbUX0H/FoUjgwXmcqKTpeVQkMHXxfHz5QSwMEFAAAAAgAtlYxXV9b0UwNAAAACwAAABEAAAB3b3JkL2RvY3VtZW50LnhtbLNJyU8uzU3NK9G3AwBQSwECFAMUAAAACAC2VjFdqIWxNZcAAADCAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIALZWMV1fW9FMDQAAAAsAAAARAAAAAAAAAAAAAACAAcgAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAgACAIAAAAAEAQAAAAA=','base64');
const bombDocx=Buffer.from('UEsDBBQAAAAIALZWMV1qaKow/wAAAEwSAQATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbO3Nu07DQBAF0F+x3KJkIwoKlKShB4r8wMreJBbxQ/YSyN9jCykFNeU53Wjm3tkebkOaiu/20k278pzz8BzCVJ1TG6d1P6Ru3hz7sY15HsdTGGL1EU8pPG42T6Hqu5y6vMpLR7nfvl3TODZ1Kt7jmF9jm3Zl+OrHOtR99dnOl+u5rSxefmPL510Zh+HSVDE3fReuXf3n56o/Hpsq3fNL2zD2VZqmpju1l/V908ame1jqw74AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP7dNhxuQ5r2P1BLAwQUAAAACAC2VjFdX1vRTA0AAAALAAAAEQAAAHdvcmQvZG9jdW1lbnQueG1ss0nJTy7NTc0r0bcDAFBLAQIUAxQAAAAIALZWMV1qaKow/wAAAEwSAQATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgAtlYxXV9b0UwNAAAACwAAABEAAAAAAAAAAAAAAIABMAEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAACAAIAgAAAAGwBAAAAAA==','base64');
test('DOCX原字节通过目录与非宏内容类型检查，宏和超大XML被拒绝',async()=>{
 const result=await downloadAttachment({...options,filename:'简历.docx'},transportFor([validDocx]));
 expect(result.extension).toBe('.docx');expect(result.buffer.equals(validDocx)).toBe(true);
 await expect(inspectAttachmentFile(macroDocx,'简历.docx')).rejects.toThrow();
 await expect(inspectAttachmentFile(bombDocx,'简历.docx')).rejects.toThrow();
});
test('传输30秒无响应会中止，不返回附件',async()=>{
 let aborted=false;
 const transport:AttachmentTransport=async(_url,signal)=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(new TypeError('aborted'));},{once:true});});
 await expect(downloadAttachment(options,transport)).rejects.toThrow();expect(aborted).toBe(true);
},35000);
test('无后缀平台附件名按魔数补齐后缀，ZIP仍须通过DOCX检验',async()=>{
 const pdfResult=await downloadAttachment({...options,filename:'附件简历'},transportFor([pdf]));
 expect(pdfResult.filename).toBe('附件简历.pdf');
 const doc=Buffer.from('d0cf11e0a1b11ae1','hex');
 const docResult=await downloadAttachment({...options,filename:'附件简历'},transportFor([doc]));
 expect(docResult.filename).toBe('附件简历.doc');
 const docxResult=await downloadAttachment({...options,filename:'附件简历'},transportFor([validDocx]));
 expect(docxResult.filename).toBe('附件简历.docx');
 await expect(downloadAttachment({...options,filename:'附件简历'},transportFor([Buffer.from('PK\x03\x04not-docx')]))).rejects.toThrow();
 await expect(downloadAttachment({...options,filename:'附件简历.doc'},transportFor([pdf]))).rejects.toThrow();
 await expect(downloadAttachment({...options,filename:'附件简历.exe'},transportFor([pdf]))).rejects.toThrow();
});
