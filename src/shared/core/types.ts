import { z } from 'zod';

// Reasoning effort levels for AI models
export const ReasoningEffortSchema = z.enum(['low', 'medium', 'high']);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

// Message role types
export const MessageRoleSchema = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

// File attachment metadata saved with a message
export const AttachmentSchema = z.object({
    id: z.string().min(1, 'Attachment id is required'),
    name: z.string().min(1, 'Attachment name is required'),
    mimeType: z.string().min(1, 'Attachment MIME type is required'),
    size: z.number().int().nonnegative(),
    path: z.string().min(1, 'Attachment path is required'),
    url: z.string().min(1, 'Attachment URL is required'),
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
    content: z.string(),
    attachments: z.array(AttachmentSchema).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Chat API request body
export const ChatRequestSchema = z.object({
    messages: z.array(ChatMessageSchema).min(1, 'At least one message is required'),
    model: z.string().min(1, 'Model is required'),
    reasoningEffort: ReasoningEffortSchema.optional(),
    systemPrompt: z.string().max(50000, 'System prompt must be 50000 characters or less').optional(),
    search: z.boolean().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
