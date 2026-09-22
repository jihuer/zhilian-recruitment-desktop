import { z } from 'zod';

export const LOCAL_MODEL_URL = 'http://127.0.0.1:11435/v1';
export const LOCAL_MODELS = [
  { id: 'qwen2.5:3b', label: 'Qwen 2.5 3B · 约 1.9 GB', bytes: 2_100_000_000 },
  { id: 'qwen2.5:0.5b', label: 'Qwen 2.5 0.5B · 约 0.4 GB（轻量测试）', bytes: 450_000_000 },
] as const;
export const LocalModelStatusSchema = z.object({
  phase: z.enum(['idle', 'installing', 'ready', 'error']),
  message: z.string(), progress: z.number().min(0).max(100), model: z.string(),
});
export type LocalModelStatus = z.infer<typeof LocalModelStatusSchema>;
