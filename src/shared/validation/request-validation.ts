import { z } from 'zod';

import {
    MAX_CLEANUP_PATHS,
    MAX_THREAD_ID_CHARS,
    MAX_ATTACHMENT_PATH_CHARS,
} from '@/shared/validation/request-limits';

const ThreadIdSchema = z.string().trim().min(1, 'threadId is required').max(MAX_THREAD_ID_CHARS);
export const UploadCleanupRequestSchema = z.object({
    threadId: ThreadIdSchema,
    paths: z.array(z.string().min(1).max(MAX_ATTACHMENT_PATH_CHARS)).max(MAX_CLEANUP_PATHS).optional(),
});

export type UploadCleanupRequest = z.infer<typeof UploadCleanupRequestSchema>;
