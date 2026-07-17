import { z } from 'zod';

import {
    MAX_ATTACHMENT_ID_CHARS,
    MAX_ATTACHMENT_MIME_TYPE_CHARS,
    MAX_ATTACHMENT_NAME_CHARS,
    MAX_ATTACHMENT_PATH_CHARS,
    MAX_ATTACHMENT_SIZE_BYTES,
    MAX_ATTACHMENT_URL_CHARS,
    MAX_ATTACHMENTS_PER_MESSAGE,
    MAX_CHAT_MESSAGE_CHARS,
    MAX_CHAT_MESSAGES,
    MAX_CHAT_REQUEST_ATTACHMENTS,
    MAX_CHAT_REQUEST_TEXT_CHARS,
    MAX_MODEL_ID_CHARS,
} from '@/shared/validation/request-limits';

// Reasoning effort levels for AI models
export const ReasoningEffortSchema = z.enum(['low', 'medium', 'high']);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

// Message role types
export const MessageRoleSchema = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

// File attachment metadata saved with a message
export const AttachmentSchema = z.object({
    id: z.string().min(1, 'Attachment id is required').max(MAX_ATTACHMENT_ID_CHARS),
    name: z.string().min(1, 'Attachment name is required').max(MAX_ATTACHMENT_NAME_CHARS),
    mimeType: z.string().min(1, 'Attachment MIME type is required').max(MAX_ATTACHMENT_MIME_TYPE_CHARS),
    size: z.number().int().nonnegative().max(MAX_ATTACHMENT_SIZE_BYTES),
    path: z.string().min(1, 'Attachment path is required').max(MAX_ATTACHMENT_PATH_CHARS),
    url: z.string().min(1, 'Attachment URL is required').max(MAX_ATTACHMENT_URL_CHARS),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

// Persisted assistant response performance stats.
export const ChatResponseStatsSchema = z.object({
    outputTokens: z.number().int().nonnegative(),
    seconds: z.number().nonnegative(),
    tokensPerSecond: z.number().nonnegative(),
    ttfbSeconds: z.number().nonnegative().optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    source: z.enum(['estimated', 'provider']).optional(),
});
export type ChatResponseStats = z.infer<typeof ChatResponseStatsSchema>;

// Single message in a chat request
export const ChatMessageSchema = z.object({
    role: MessageRoleSchema,
    content: z.string().max(MAX_CHAT_MESSAGE_CHARS, 'Message content is too long'),
    attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Chat API request body
export const ChatRequestSchema = z.object({
    messages: z.array(ChatMessageSchema)
        .min(1, 'At least one message is required')
        .max(MAX_CHAT_MESSAGES, 'Too many messages in one request'),
    model: z.string().min(1, 'Model is required').max(MAX_MODEL_ID_CHARS),
    reasoningEffort: ReasoningEffortSchema.optional(),
    systemPrompt: z.string().max(50000, 'System prompt must be 50000 characters or less').optional(),
    search: z.boolean().optional(),
}).superRefine((value, context) => {
    const totalTextChars = value.messages.reduce((total, message) => total + message.content.length, 0);
    if (totalTextChars > MAX_CHAT_REQUEST_TEXT_CHARS) {
        context.addIssue({
            code: 'custom',
            path: ['messages'],
            message: 'Combined message content is too long',
        });
    }

    const totalAttachments = value.messages.reduce(
        (total, message) => total + (message.attachments?.length ?? 0),
        0
    );
    if (totalAttachments > MAX_CHAT_REQUEST_ATTACHMENTS) {
        context.addIssue({
            code: 'custom',
            path: ['messages'],
            message: 'Too many attachments in one request',
        });
    }
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
