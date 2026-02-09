import { z } from 'zod';

// Reasoning effort levels for AI models
export const ReasoningEffortSchema = z.enum(['low', 'medium', 'high']);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

// Message role types
export const MessageRoleSchema = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

// Single message in a chat request
export const ChatMessageSchema = z.object({
    role: MessageRoleSchema,
    content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Chat API request body
export const ChatRequestSchema = z.object({
    messages: z.array(ChatMessageSchema).min(1, 'At least one message is required'),
    model: z.string().min(1, 'Model is required'),
    reasoningEffort: ReasoningEffortSchema.optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
