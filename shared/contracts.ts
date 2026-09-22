import { z } from 'zod';
import { KnowledgeDocumentSchema } from './knowledge';
import { LocalModelStatusSchema } from './local-models';

export const AccountSchema = z.object({ id:z.string(), name:z.string(), status:z.enum(['connected','unverified','expired','disconnected']), lastSync:z.string(), company:z.string(), source:z.literal('智联招聘'),platformIdentity:z.string().optional(),identityVerifiedAt:z.string().optional() });
export const JobSchema = z.object({ id:z.string(), accountId:z.string(), title:z.string(), city:z.string(), salary:z.string(), status:z.string() });
export const HistoryMessageSchema=z.object({id:z.string(),text:z.string().max(12000),at:z.string(),senderId:z.string(),kind:z.string(),direction:z.enum(['incoming','outgoing','unknown']).optional(),clientMessageId:z.string().optional()});
export const CandidateSchema = z.object({ id:z.string(), accountId:z.string(), jobId:z.string(), name:z.string().max(100), resume:z.string().max(20000), message:z.string().max(12000), draft:z.string().max(12000), mode:z.enum(['draft','human']), updatedAt:z.string(), source:z.enum(['manual','platform']).optional(),platformSessionId:z.string().optional(),platformUserId:z.string().optional(),platformPeerPartnerId:z.string().optional(),platformResumeNumber:z.string().optional(),platformResumeLanguage:z.string().optional(),platformJobNumber:z.string().optional(),platformResumeText:z.string().max(20000).optional(),platformResumeFetchedAt:z.string().optional(),history:z.array(HistoryMessageSchema).max(1000).optional(),historyFetchedAt:z.string().optional(),platformJobTitle:z.string().optional(),platformUpdatedAt:z.string().optional(),unreadCount:z.number().int().nonnegative().optional() });
export const TemplateSchema = z.object({ id:z.string(), name:z.string().min(1).max(80), text:z.string().min(1).max(2000) });
export const RuleSchema = z.object({ jobId:z.string(), facts:z.string().max(12000), faq:z.string().max(12000), questions:z.string().max(4000), skills:z.string().max(2000) });
export const TaskInputSchema = z.object({ accountId:z.string().min(1), jobId:z.string().min(1), templateId:z.string().min(1), intervalMinutes:z.number().int().min(1).max(1440), limit:z.number().int().min(1).max(1000), skills:z.string().max(2000), city:z.string().max(100), mode:z.enum(['draft','send']) });
export const TaskSchema = TaskInputSchema.extend({ id:z.string(), status:z.enum(['running','paused','stopped','completed','blocked']), createdAt:z.string(), processed:z.number(), drafted:z.number(), sent:z.number(), skipped:z.number(), reason:z.string(), nextAt:z.string(), candidateIds:z.array(z.string()), templateText:z.string() });
export const SettingsSchema = z.object({ chromePath:z.string(), aiBaseUrl:z.string(), aiModel:z.string(), hasApiKey:z.boolean(), aiProvider:z.enum(['codex','api','local']).optional() });
export const EventSchema = z.object({ id:z.string(), at:z.string(), message:z.string() });
export const AutoReplySchema=z.object({candidateId:z.string(),mode:z.enum(['draft','send']),status:z.enum(['enabled','paused','off']),startedAt:z.string(),nextCheckAt:z.string(),lastMessageId:z.string(),reason:z.string()});
export const ReplyAttemptSchema=z.object({id:z.string(),candidateId:z.string(),inboundId:z.string(),inboundIds:z.array(z.string()).optional(),status:z.enum(['generating','drafted','sending','accepted','confirmed','uncertain','failed','discarded']),text:z.string().max(4000),createdAt:z.string(),updatedAt:z.string(),reason:z.string()});
export type AutoReply=z.infer<typeof AutoReplySchema>;
export type ReplyAttempt=z.infer<typeof ReplyAttemptSchema>;
export const ModelTestSchema=z.object({status:z.enum(['idle','running','passed','failed']),message:z.string(),answer:z.string(),at:z.string(),sources:z.array(z.object({title:z.string(),scope:z.string(),text:z.string()}))});
export const ModelConfigurationSchema=SettingsSchema.omit({hasApiKey:true,chromePath:true}).extend({apiKey:z.string().max(2000)});
export const StateSchema = z.object({ knowledge:z.array(KnowledgeDocumentSchema).max(500).default([]), localModel:LocalModelStatusSchema.default({phase:'idle',message:'尚未安装本地模型',progress:0,model:''}),modelTest:ModelTestSchema.default({status:'idle',message:'',answer:'',at:'',sources:[]}), autoReplies:z.array(AutoReplySchema).default([]),replyAttempts:z.array(ReplyAttemptSchema).default([]),accounts:z.array(AccountSchema), jobs:z.array(JobSchema), candidates:z.array(CandidateSchema), templates:z.array(TemplateSchema), rules:z.array(RuleSchema), tasks:z.array(TaskSchema), events:z.array(EventSchema), settings:SettingsSchema, connection:z.object({ phase:z.enum(['idle','opening','waiting','verifying','error']), message:z.string() }), capabilities:z.object({ jobs:z.boolean(), conversations:z.boolean(), greeting:z.boolean(), reply:z.boolean() }) });
export type Account=z.infer<typeof AccountSchema>;
export type Job=z.infer<typeof JobSchema>;
export type Candidate=z.infer<typeof CandidateSchema>;
export type Template=z.infer<typeof TemplateSchema>;
export type Rule=z.infer<typeof RuleSchema>;
export type Task=z.infer<typeof TaskSchema>;
export type State=z.infer<typeof StateSchema>;
export const CommandSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('state')}),
 z.object({type:z.literal('saveKnowledge'),value:KnowledgeDocumentSchema}),
 z.object({type:z.literal('deleteKnowledge'),id:z.string()}),
 z.object({type:z.literal('installLocalModel'),model:z.string()}),
 z.object({type:z.literal('cancelLocalModel')}),
 z.object({type:z.literal('testModel'),value:ModelConfigurationSchema,jobId:z.string().optional(),question:z.string().min(1).max(2000)}),
 z.object({type:z.literal('connect'),name:z.string().min(1).max(80)}),
 z.object({type:z.literal('cancelConnect')}),
 z.object({type:z.literal('disconnect'),id:z.string()}),
 z.object({type:z.literal('syncJobs'),id:z.string()}),
 z.object({type:z.literal('syncConversations'),id:z.string()}),
 z.object({type:z.literal('saveTemplate'),value:TemplateSchema}),
 z.object({type:z.literal('saveRule'),value:RuleSchema}),
 z.object({type:z.literal('saveCandidate'),value:CandidateSchema}),
 z.object({type:z.literal('generateDraft'),id:z.string()}),
 z.object({type:z.literal('testCodex')}),
 z.object({type:z.literal('checkReplyAccess'),id:z.string()}),
 z.object({type:z.literal('autoReplyAction'),id:z.string(),action:z.enum(['enableDraft','enableSend','pause','stop','check','reconcile'])}),
 z.object({type:z.literal('downloadAttachment'),id:z.string()}),
 z.object({type:z.literal('loadResume'),id:z.string()}),
 z.object({type:z.literal('loadHistory'),id:z.string(),older:z.boolean().optional()}),
 z.object({type:z.literal('verifyIdentity'),id:z.string()}),
 z.object({type:z.literal('createTask'),value:TaskInputSchema}),
 z.object({type:z.literal('taskAction'),id:z.string(),action:z.enum(['pause','resume','stop'])}),
 z.object({type:z.literal('saveSettings'),value:SettingsSchema.omit({hasApiKey:true}).extend({apiKey:z.string().max(2000)})}),
 z.object({type:z.literal('chooseChrome')}),
 z.object({type:z.literal('exportData')}),
]);
export type Command=z.infer<typeof CommandSchema>;
export type Reply={readonly ok:true; readonly state:State; readonly message?:string}|{readonly ok:false;readonly error:string};
export type DesktopApi={readonly invoke:(command:Command)=>Promise<Reply>;readonly subscribe:(listener:(state:State)=>void)=>()=>void};
