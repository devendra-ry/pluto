import { z } from 'zod';

const UsageEventSchema = z.object({
    meta: z.literal('usage'),
    usage: z.object({
        source: z.enum(['estimated', 'provider']).optional(),
        inputTokens: z.number().nonnegative().optional(),
        outputTokens: z.number().nonnegative().optional(),
        totalTokens: z.number().nonnegative().optional(),
        total_tokens: z.number().nonnegative().optional(),
        prompt_tokens: z.number().nonnegative().optional(),
        completion_tokens: z.number().nonnegative().optional(),
        promptTokenCount: z.number().nonnegative().optional(),
        candidatesTokenCount: z.number().nonnegative().optional(),
        totalTokenCount: z.number().nonnegative().optional(),
        tokens_prompt: z.number().nonnegative().optional(),
        tokens_completion: z.number().nonnegative().optional(),
        native_tokens_prompt: z.number().nonnegative().optional(),
        native_tokens_completion: z.number().nonnegative().optional(),
    }).passthrough(),
}).passthrough();

const TextDeltaEventSchema = z.object({
    c: z.string().optional(),
    r: z.string().optional(),
    content: z.string().optional(),
    reasoning_content: z.string().optional(),
    thinking: z.string().optional(),
}).passthrough().refine((event) =>
    event.c !== undefined
    || event.r !== undefined
    || event.content !== undefined
    || event.reasoning_content !== undefined
    || event.thinking !== undefined
);

const LegacyChoiceEventSchema = z.object({
    choices: z.array(z.object({
        delta: z.object({
            content: z.string().optional(),
            reasoning_content: z.string().optional(),
        }).passthrough(),
    }).passthrough()).min(1),
}).passthrough();

const ErrorEventSchema = z.object({
    error: z.string(),
    details: z.string().optional(),
}).passthrough();

export type ChatStreamUsage = z.infer<typeof UsageEventSchema>['usage'];

export type ChatStreamEvent =
    | { type: 'delta'; content: string; reasoning: string }
    | { type: 'usage'; usage: ChatStreamUsage }
    | { type: 'error'; message: string; details?: string };

export function parseChatStreamPayload(payload: unknown): ChatStreamEvent | null {
    const usageResult = UsageEventSchema.safeParse(payload);
    if (usageResult.success) {
        return { type: 'usage', usage: usageResult.data.usage };
    }

    const errorResult = ErrorEventSchema.safeParse(payload);
    if (errorResult.success) {
        return {
            type: 'error',
            message: errorResult.data.error,
            ...(errorResult.data.details === undefined ? {} : { details: errorResult.data.details }),
        };
    }

    const choiceResult = LegacyChoiceEventSchema.safeParse(payload);
    if (choiceResult.success) {
        const delta = choiceResult.data.choices[0]?.delta;
        return {
            type: 'delta',
            content: delta?.content ?? '',
            reasoning: delta?.reasoning_content ?? '',
        };
    }

    const deltaResult = TextDeltaEventSchema.safeParse(payload);
    if (!deltaResult.success) return null;

    return {
        type: 'delta',
        content: deltaResult.data.c ?? deltaResult.data.content ?? '',
        reasoning: deltaResult.data.r ?? deltaResult.data.reasoning_content ?? deltaResult.data.thinking ?? '',
    };
}

export function parseChatStreamEvent(raw: string): ChatStreamEvent | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        return parseChatStreamPayload(parsed);
    } catch {
        return null;
    }
}

export function serializeChatStreamEvent(event: ChatStreamEvent): string {
    switch (event.type) {
        case 'delta':
            return JSON.stringify({
                ...(event.content ? { c: event.content } : {}),
                ...(event.reasoning ? { r: event.reasoning } : {}),
            });
        case 'usage':
            return JSON.stringify({ meta: 'usage', usage: event.usage });
        case 'error':
            return JSON.stringify({
                error: event.message,
                ...(event.details === undefined ? {} : { details: event.details }),
            });
    }
}
