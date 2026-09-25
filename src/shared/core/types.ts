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
    MAX_THREAD_ID_CHARS,
} from '@/shared/validation/request-limits';

// Reasoning effort levels for AI models
const ReasoningEffortSchema = z.enum(['low', 'medium', 'high']);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export function toReasoningEffort(value: unknown): ReasoningEffort | undefined {
    return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

// Message role types
const MessageRoleSchema = z.enum(['user', 'assistant']);

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
export type ChatResponseStats = {
    outputTokens: number,
    seconds: number,
    tokensPerSecond: number,
    ttfbSeconds?: number,
    inputTokens?: number,
    totalTokens?: number,
    source?: 'estimated' | 'provider',
};

// Single message in a chat request
const ChatMessageSchema = z.object({
    role: MessageRoleSchema,
    content: z.string().max(MAX_CHAT_MESSAGE_CHARS, 'Message content is too long'),
    attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Chat API request body
export const ChatRequestSchema = z.object({
    threadId: z.string().min(1).max(MAX_THREAD_ID_CHARS),
    userMessageId: z.string().min(1).max(MAX_THREAD_ID_CHARS),
    // Accepted for compatibility with older clients. The server uses canonical
    // persisted history so long conversations aren't uploaded on every turn.
    messages: z.array(ChatMessageSchema)
        .min(1, 'At least one message is required')
        .max(MAX_CHAT_MESSAGES, 'Too many messages in one request')
        .optional(),
    model: z.string().min(1, 'Model is required').max(MAX_MODEL_ID_CHARS),
    reasoningEffort: ReasoningEffortSchema.optional(),
    systemPrompt: z.string().max(50000, 'System prompt must be 50000 characters or less').optional(),
}).superRefine((value, context) => {
    const messages = value.messages ?? [];
    const totalTextChars = messages.reduce((total, message) => total + message.content.length, 0);
    if (totalTextChars > MAX_CHAT_REQUEST_TEXT_CHARS) {
        context.addIssue({
            code: 'custom',
            path: ['messages'],
            message: 'Combined message content is too long',
        });
    }

    const totalAttachments = messages.reduce(
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
