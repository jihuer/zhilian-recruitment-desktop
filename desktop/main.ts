import { app, BrowserWindow, dialog, ipcMain, safeStorage, session } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { CommandSchema } from '../shared/contracts';
import type { Reply } from '../shared/contracts';
import { Store } from './store';
import { LocalModelManager } from './local-models';
import { Service } from './service';
import {runSendOnceCli} from './send-once-cli';

let service:Service|undefined;
let window:BrowserWindow|undefined;
let exiting=false;
if(process.env['RECRUITMENT_DATA_DIR'])app.setPath('userData',process.env['RECRUITMENT_DATA_DIR']);
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();
else {
 app.on('second-instance',()=>{window?.show();window?.focus();});
 app.on('before-quit',event=>{if(exiting||!service)return;event.preventDefault();exiting=true;void service.close().finally(()=>app.quit());});
 app.on('window-all-closed',()=>app.quit());
 void app.whenReady().then(async()=>{
  if(!safeStorage.isEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw new TypeError('系统安全存储不可用，无法安全保存账号，请检查系统钥匙串');
  const store=await Store.open(app.getPath('userData'),{encrypt:value=>safeStorage.encryptString(value).toString('base64'),decrypt:value=>safeStorage.decryptString(Buffer.from(value,'base64'))});
  const onceIndex=process.argv.indexOf('--send-once-file');
  const receiptIndex=process.argv.indexOf('--send-once-receipt');
  if(onceIndex>=0){
   const requestPath=process.argv[onceIndex+1],receiptPath=process.argv[receiptIndex+1];
   if(!requestPath||receiptIndex<0||!receiptPath){store.close();app.quit();return;}
   try{await runSendOnceCli(store,requestPath,receiptPath);}finally{store.close();app.quit();}
   return;
  }
  window=new BrowserWindow({width:1360,height:900,minWidth:960,minHeight:680,title:'招聘工作台',backgroundColor:'#f4f6fa',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  const local=new LocalModelManager(join(app.getPath('userData'),'local-models'),status=>{if(exiting)return;store.state.localModel=status;service?.changed();});
  service=new Service(store,state=>{if(window&&!window.isDestroyed())window.webContents.send('workbench:state',state);},local);
  ipcMain.handle('workbench:command',async(event,input:unknown):Promise<Reply>=>{
   if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!service)return {ok:false,error:'无效的操作来源'};
   const command=CommandSchema.safeParse(input);if(!command.success)return {ok:false,error:'输入格式不正确，请检查表单'};
   try{
    if(command.data.type==='downloadAttachment'){
     const file=await service.prepareAttachment(command.data.id);
     const selected=await dialog.showSaveDialog(window,{title:'保存附件简历',defaultPath:join(app.getPath('downloads'),file.filename),filters:[{name:'简历文件',extensions:[file.extension.replace('.','')]}]});
     if(selected.canceled||!selected.filePath)return {ok:true,state:store.state,message:'已取消保存附件'};
     await writeFile(selected.filePath,file.buffer,{mode:0o600});store.event('附件简历原文件已保存到用户选择的位置');service.changed();
     return {ok:true,state:store.state,message:'附件简历原文件已保存'};
    }
    if(command.data.type==='chooseChrome'){
     const selected=await dialog.showOpenDialog(window,{title:'选择 Google Chrome',properties:['openFile'],...(process.platform==='darwin'?{defaultPath:'/Applications/Google Chrome.app'}:{})});
     const file=selected.filePaths[0];if(!selected.canceled&&file){store.state.settings.chromePath=process.platform==='darwin'&&file.endsWith('.app')?join(file,'Contents/MacOS/Google Chrome'):file;service.changed();}
     return {ok:true,state:store.state};
    }
    if(command.data.type==='exportData'){
     const selected=await dialog.showSaveDialog(window,{title:'导出招聘资料',defaultPath:'招聘资料.json',filters:[{name:'JSON',extensions:['json']}]});
     if(!selected.canceled&&selected.filePath){const {accounts,jobs,candidates,templates,rules,tasks,autoReplies,replyAttempts,knowledge}=store.state;await writeFile(selected.filePath,JSON.stringify({exportedAt:new Date().toISOString(),accounts,jobs,candidates,templates,rules,tasks,autoReplies,replyAttempts,knowledge},null,2),{mode:0o600});return {ok:true,state:store.state,message:'招聘资料已导出，不含登录凭证与模型密钥'};}
     return {ok:true,state:store.state};
    }
    return await service.invoke(command.data);
   }catch(error){return {ok:false,error:error instanceof TypeError?error.message:'操作失败，请检查文件路径与权限'};}
  });
  await window.loadFile(join(__dirname,'../dist/index.html'));
 }).catch(error=>{dialog.showErrorBox('无法启动招聘工作台',error instanceof TypeError?error.message:'初始化失败，请检查本机数据目录和安全存储');app.quit();});
}
