import type { State } from '../shared/contracts';
import type { KnowledgeDocument } from '../shared/knowledge';

export function saveKnowledge(state:State,document:KnowledgeDocument):void{
 if(!state.accounts.some(account=>account.id===document.accountId))throw new TypeError('请选择知识库所属账号');
 if(document.scope==='job'&&!state.jobs.some(job=>job.id===document.jobId&&job.accountId===document.accountId))throw new TypeError('请选择该账号下的岗位');
 if(state.knowledge.length>=500&&!state.knowledge.some(item=>item.id===document.id))throw new TypeError('最多保存500份知识资料');
 const value={...document,updatedAt:new Date().toISOString()};
 state.knowledge=[value,...state.knowledge.filter(item=>item.id!==value.id)];
}
