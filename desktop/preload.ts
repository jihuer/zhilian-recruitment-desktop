import { contextBridge, ipcRenderer } from 'electron';
import type { Command, DesktopApi, Reply, State } from '../shared/contracts';
const api:DesktopApi={
 invoke:(command:Command):Promise<Reply>=>ipcRenderer.invoke('workbench:command',command),
 subscribe:(listener:(state:State)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,state:State)=>listener(state);ipcRenderer.on('workbench:state',handler);return ()=>ipcRenderer.removeListener('workbench:state',handler);},
};
contextBridge.exposeInMainWorld('desktop',api);
