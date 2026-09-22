import { z } from 'zod';

export const KnowledgeDocumentSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(120),
  scope: z.enum(['company', 'job']),
  accountId: z.string().min(1),
  jobId: z.string(),
  text: z.string().trim().min(1).max(100000),
  updatedAt: z.string(),
}).refine(value => value.scope === 'company' ? value.jobId === '' : value.jobId.length > 0, {
  message: '公司知识不绑定岗位；岗位知识必须选择岗位', path: ['jobId'],
});

export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;
export type KnowledgeHit = {
  readonly documentId: string;
  readonly title: string;
  readonly scope: KnowledgeDocument['scope'];
  readonly text: string;
};
