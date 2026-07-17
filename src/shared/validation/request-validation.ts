import { z } from 'zod';

import { AttachmentSchema } from '@/shared/core/types';
import {
    MAX_ATTACHMENTS_PER_MESSAGE,
    MAX_CLEANUP_PATHS,
    MAX_MODEL_ID_CHARS,
    MAX_NEGATIVE_PROMPT_CHARS,
    MAX_PROMPT_CHARS,
    MAX_THREAD_ID_CHARS,
    MAX_ATTACHMENT_PATH_CHARS,
} from '@/shared/validation/request-limits';

const ThreadIdSchema = z.string().trim().min(1, 'threadId is required').max(MAX_THREAD_ID_CHARS);
const OptionalModelSchema = z.string().trim().min(1).max(MAX_MODEL_ID_CHARS).optional();
const PromptSchema = z.string().trim().min(1, 'prompt is required').max(MAX_PROMPT_CHARS);

export const ImageGenerateRequestSchema = z.object({
    threadId: ThreadIdSchema,
    model: OptionalModelSchema,
    prompt: PromptSchema,
    attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).optional().default([]),
});

export type ImageGenerateRequest = z.infer<typeof ImageGenerateRequestSchema>;

export const VideoGenerateRequestSchema = z.object({
    threadId: ThreadIdSchema,
    model: OptionalModelSchema,
    prompt: PromptSchema,
    attachments: z.array(AttachmentSchema).max(1, 'Image to Video accepts one attachment').default([]),
    negative_prompt: z.string().max(MAX_NEGATIVE_PROMPT_CHARS).optional(),
    resolution: z.string().max(32).optional(),
    frames: z.number().finite().optional(),
    fps: z.number().finite().optional(),
    fast: z.boolean().optional(),
    guidance_scale: z.number().finite().optional(),
    seed: z.number().int().nullable().optional(),
});

export type VideoGenerateRequest = z.infer<typeof VideoGenerateRequestSchema>;

export const UploadCleanupRequestSchema = z.object({
    threadId: ThreadIdSchema,
    paths: z.array(z.string().min(1).max(MAX_ATTACHMENT_PATH_CHARS)).max(MAX_CLEANUP_PATHS).optional(),
});

export type UploadCleanupRequest = z.infer<typeof UploadCleanupRequestSchema>;
