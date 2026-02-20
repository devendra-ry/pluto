import { z } from 'zod';

import { AttachmentSchema } from '@/lib/types';

export const ImageGenerateRequestSchema = z.object({
    threadId: z.string().trim().min(1, 'threadId is required'),
    model: z.string().trim().min(1).optional(),
    prompt: z.string().trim().min(1, 'prompt is required'),
    attachments: z.array(AttachmentSchema).optional().default([]),
});

export type ImageGenerateRequest = z.infer<typeof ImageGenerateRequestSchema>;

export const VideoGenerateRequestSchema = z.object({
    threadId: z.string().trim().min(1, 'threadId is required'),
    model: z.string().trim().min(1).optional(),
    prompt: z.string().trim().min(1, 'prompt is required'),
    attachments: z.array(AttachmentSchema).default([]),
    negative_prompt: z.string().optional(),
    resolution: z.string().optional(),
    frames: z.number().finite().optional(),
    fps: z.number().finite().optional(),
    fast: z.boolean().optional(),
    guidance_scale: z.number().finite().optional(),
    seed: z.number().int().nullable().optional(),
});

export type VideoGenerateRequest = z.infer<typeof VideoGenerateRequestSchema>;

export const UploadCleanupRequestSchema = z.object({
    threadId: z.string().trim().min(1, 'threadId is required'),
    paths: z.array(z.string().min(1)).optional(),
});

export type UploadCleanupRequest = z.infer<typeof UploadCleanupRequestSchema>;
