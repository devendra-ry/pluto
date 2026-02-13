import { ChatRequestSchema, ChatMessage, type ReasoningEffort } from '@/lib/types';
import { AVAILABLE_MODELS, type ModelConfig } from '@/lib/constants';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';
import {
    DEFAULT_ATTACHMENTS_BUCKET,
    MAX_ATTACHMENTS_PER_MESSAGE,
    MAX_ATTACHMENT_BYTES_FOR_MODEL,
    isImageAttachment,
    isPdfAttachment,
} from '@/lib/attachments';

export const runtime = 'edge';

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
const DEFAULT_OUTPUT_RESERVE_TOKENS = 4096;
const DEFAULT_SAFETY_MARGIN_TOKENS = 2048;
const DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS = 65536;
const MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL = 25 * 1024 * 1024;
const MIN_INPUT_BUDGET_TOKENS = 2048;
const CONTEXT_RETRY_SCALE = 0.7;
const DEFAULT_LIMITS_CACHE_TTL_MS = 30 * 60 * 1000;

type LimitsSource = 'google' | 'openrouter' | 'chutes' | 'fallback';

interface ResolvedModelLimits {
    contextWindowTokens: number;
    maxOutputTokens: number | null;
    source: LimitsSource;
}

interface CachedLimitsEntry {
    value: ResolvedModelLimits;
    expiresAt: number;
}

interface TrimmedContext {
    messages: ChatMessage[];
    trimmedCount: number;
    estimatedTokens: number;
    inputBudget: number;
    contextWindow: number;
    outputReserve: number;
}

interface PreparedAttachment {
    id: string;
    name: string;
    mimeType: string;
    path: string;
    base64Data: string;
    dataUrl: string;
}

interface PreparedChatMessage {
    role: 'user' | 'assistant';
    content: string;
    attachments: PreparedAttachment[];
}

const LIMITS_CACHE_TTL_MS = readPositiveInt(process.env.CHAT_LIMITS_CACHE_TTL_MS, DEFAULT_LIMITS_CACHE_TTL_MS);
const limitsCache = new Map<string, CachedLimitsEntry>();
const ATTACHMENTS_BUCKET =
    process.env.SUPABASE_ATTACHMENTS_BUCKET ||
    process.env.NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET ||
    DEFAULT_ATTACHMENTS_BUCKET;

function readPositiveInt(value: string | undefined, fallback: number) {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function toPositiveInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return null;
}

function resolveOutputTokenCap(maxOutputTokens: number | null | undefined) {
    const parsed = toPositiveInt(maxOutputTokens);
    return parsed ?? DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS;
}

function getCachedLimits(cacheKey: string): ResolvedModelLimits | null {
    const cached = limitsCache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        limitsCache.delete(cacheKey);
        return null;
    }
    return cached.value;
}

function setCachedLimits(cacheKey: string, value: ResolvedModelLimits) {
    limitsCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + LIMITS_CACHE_TTL_MS,
    });
}

function getFallbackLimits(): ResolvedModelLimits {
    return {
        contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
        maxOutputTokens: null,
        source: 'fallback',
    };
}

async function resolveModelLimits(model: string, modelConfig: ModelConfig, signal?: AbortSignal): Promise<ResolvedModelLimits> {
    const cacheKey = `${modelConfig.provider}:${model}`;
    const cached = getCachedLimits(cacheKey);
    if (cached) return cached;

    let resolved: ResolvedModelLimits | null = null;
    try {
        if (modelConfig.provider === 'google') {
            resolved = await resolveGoogleModelLimits(model, signal);
        } else if (modelConfig.provider === 'openrouter') {
            resolved = await resolveOpenRouterModelLimits(model, signal);
        } else {
            resolved = await resolveChutesModelLimits(model, signal);
        }
    } catch (error) {
        console.warn(`[chat] failed to resolve provider limits for model=${model}`, error);
    }

    const finalLimits = resolved ?? getFallbackLimits();
    setCachedLimits(cacheKey, finalLimits);
    return finalLimits;
}

async function resolveGoogleModelLimits(model: string, signal?: AbortSignal): Promise<ResolvedModelLimits | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const modelId = model.startsWith('models/') ? model.slice('models/'.length) : model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, { method: 'GET', signal });
    if (!response.ok) return null;

    const payload = await response.json() as Record<string, unknown>;
    const contextWindowTokens = toPositiveInt(payload.inputTokenLimit);
    if (!contextWindowTokens) return null;

    return {
        contextWindowTokens,
        maxOutputTokens: toPositiveInt(payload.outputTokenLimit),
        source: 'google',
    };
}

async function resolveOpenRouterModelLimits(model: string, signal?: AbortSignal): Promise<ResolvedModelLimits | null> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;

    const response = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        signal,
    });

    if (!response.ok) return null;

    const payload = await response.json() as Record<string, unknown>;
    const data = payload.data;
    if (!Array.isArray(data)) return null;

    const modelEntry = data.find((item) => {
        if (!item || typeof item !== 'object') return false;
        const record = item as Record<string, unknown>;
        return record.id === model;
    }) as Record<string, unknown> | undefined;

    if (!modelEntry) return null;

    const topProvider = (modelEntry.top_provider && typeof modelEntry.top_provider === 'object')
        ? modelEntry.top_provider as Record<string, unknown>
        : null;

    const contextWindowTokens =
        toPositiveInt(modelEntry.context_length) ??
        toPositiveInt(topProvider?.context_length);

    if (!contextWindowTokens) return null;

    return {
        contextWindowTokens,
        maxOutputTokens:
            toPositiveInt(topProvider?.max_completion_tokens) ??
            toPositiveInt(modelEntry.max_completion_tokens) ??
            toPositiveInt(modelEntry.max_output_length),
        source: 'openrouter',
    };
}

async function resolveChutesModelLimits(model: string, signal?: AbortSignal): Promise<ResolvedModelLimits | null> {
    const apiKey = process.env.CHUTES_API_KEY;
    if (!apiKey) return null;

    const response = await fetch('https://llm.chutes.ai/v1/models', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        signal,
    });

    if (!response.ok) return null;

    const payload = await response.json() as Record<string, unknown>;
    const data = payload.data;
    if (!Array.isArray(data)) return null;

    const modelEntry = data.find((item) => {
        if (!item || typeof item !== 'object') return false;
        const record = item as Record<string, unknown>;
        return record.id === model;
    }) as Record<string, unknown> | undefined;

    if (!modelEntry) return null;

    const contextWindowTokens =
        toPositiveInt(modelEntry.context_length) ??
        toPositiveInt(modelEntry.max_prompt_tokens) ??
        toPositiveInt(modelEntry.input_token_limit);

    if (!contextWindowTokens) return null;

    return {
        contextWindowTokens,
        maxOutputTokens:
            toPositiveInt(modelEntry.max_completion_tokens) ??
            toPositiveInt(modelEntry.max_output_tokens) ??
            toPositiveInt(modelEntry.output_token_limit) ??
            toPositiveInt(modelEntry.max_output_length),
        source: 'chutes',
    };
}

function estimateMessageTokens(message: ChatMessage) {
    // Simple, fast approximation for mixed text/markdown/code content.
    const attachmentCount = message.attachments?.length ?? 0;
    const attachmentBudget = attachmentCount * 1200;
    return Math.ceil(message.content.length / 3.5) + 8 + attachmentBudget;
}

function estimateConversationTokens(messages: ChatMessage[]) {
    return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

function findLastUserIndex(messages: ChatMessage[]) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') return i;
    }
    return -1;
}

function trimMessagesToInputBudget(
    messages: ChatMessage[],
    limits: ResolvedModelLimits,
    budgetScale: number = 1
): TrimmedContext {
    const outputCeiling = limits.maxOutputTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS;
    const outputReserve = Math.max(512, Math.min(DEFAULT_OUTPUT_RESERVE_TOKENS, outputCeiling));
    const baseInputBudget = Math.max(
        MIN_INPUT_BUDGET_TOKENS,
        limits.contextWindowTokens - outputReserve - DEFAULT_SAFETY_MARGIN_TOKENS
    );
    const normalizedScale = Math.min(1, Math.max(0.2, budgetScale));
    const inputBudget = Math.max(
        MIN_INPUT_BUDGET_TOKENS,
        Math.floor(baseInputBudget * normalizedScale)
    );

    if (messages.length === 0) {
        return {
            messages,
            trimmedCount: 0,
            estimatedTokens: 0,
            inputBudget,
            contextWindow: limits.contextWindowTokens,
            outputReserve,
        };
    }

    let usedTokens = 0;
    let startIndex = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
        const estimated = estimateMessageTokens(messages[i]);
        if (usedTokens + estimated > inputBudget && startIndex < messages.length) {
            break;
        }
        usedTokens += estimated;
        startIndex = i;
    }

    let trimmedMessages = messages.slice(startIndex);
    let estimatedTokens = usedTokens;

    // Always retain at least one user turn for coherent continuation.
    if (!trimmedMessages.some((message) => message.role === 'user')) {
        const lastUserIndex = findLastUserIndex(messages);
        if (lastUserIndex !== -1) {
            trimmedMessages = messages.slice(lastUserIndex);
            estimatedTokens = estimateConversationTokens(trimmedMessages);
        } else {
            trimmedMessages = [messages[messages.length - 1]];
            estimatedTokens = estimateConversationTokens(trimmedMessages);
        }
    }

    return {
        messages: trimmedMessages,
        trimmedCount: messages.length - trimmedMessages.length,
        estimatedTokens,
        inputBudget,
        contextWindow: limits.contextWindowTokens,
        outputReserve,
    };
}

function isContextOverflowError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();

    const patterns = [
        'context length',
        'maximum context',
        'max context',
        'token limit',
        'too many tokens',
        'prompt is too long',
        'input is too long',
        'exceeds the maximum',
        'context window',
    ];

    return patterns.some((pattern) => normalized.includes(pattern));
}

function supportsImageInputs(modelConfig: ModelConfig) {
    return modelConfig.capabilities.includes('vision');
}

function supportsPdfInputs(modelConfig: ModelConfig) {
    const isChutesBackedModel = modelConfig.provider !== 'google' && modelConfig.provider !== 'openrouter';
    return modelConfig.capabilities.includes('pdf') || modelConfig.provider === 'google' || isChutesBackedModel;
}

function toBase64(bytes: Uint8Array) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

async function prepareMessageAttachments(
    messages: ChatMessage[],
    supabase: ReturnType<typeof createClient>,
    userId: string,
    modelConfig: ModelConfig,
    signal?: AbortSignal
): Promise<PreparedChatMessage[]> {
    const allowImages = supportsImageInputs(modelConfig);
    const allowPdfs = supportsPdfInputs(modelConfig);
    let totalAttachmentBytes = 0;

    const prepared: PreparedChatMessage[] = [];
    for (const message of messages) {
        const attachments = message.attachments ?? [];
        if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
            throw new Error(`Too many attachments in a single message. Maximum is ${MAX_ATTACHMENTS_PER_MESSAGE}.`);
        }

        const preparedAttachments: PreparedAttachment[] = [];
        let skippedForCapabilities = 0;
        for (const attachment of attachments) {
            if (signal?.aborted) throw new Error('Request aborted');

            if (!attachment.path.startsWith(`${userId}/`)) {
                throw new Error('Invalid attachment path');
            }

            const imageAttachment = isImageAttachment(attachment.mimeType);
            const pdfAttachment = isPdfAttachment(attachment.mimeType);

            if (!imageAttachment && !pdfAttachment) {
                throw new Error(`Unsupported attachment type: ${attachment.mimeType}`);
            }
            if (imageAttachment && !allowImages) {
                skippedForCapabilities += 1;
                continue;
            }
            if (pdfAttachment && !allowPdfs) {
                skippedForCapabilities += 1;
                continue;
            }

            const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(attachment.path);
            if (error || !data) {
                throw new Error(`Failed to load attachment: ${attachment.name}`);
            }

            const buffer = new Uint8Array(await data.arrayBuffer());
            if (buffer.byteLength > MAX_ATTACHMENT_BYTES_FOR_MODEL) {
                const maxMb = Math.floor(MAX_ATTACHMENT_BYTES_FOR_MODEL / (1024 * 1024));
                throw new Error(`Attachment "${attachment.name}" exceeds model limit (${maxMb}MB).`);
            }
            totalAttachmentBytes += buffer.byteLength;
            if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL) {
                const maxMb = Math.floor(MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL / (1024 * 1024));
                throw new Error(`Total attachment payload is too large for one request (${maxMb}MB max).`);
            }

            const base64Data = toBase64(buffer);
            preparedAttachments.push({
                id: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                path: attachment.path,
                base64Data,
                dataUrl: `data:${attachment.mimeType};base64,${base64Data}`,
            });
        }

        prepared.push({
            role: message.role,
            content: skippedForCapabilities > 0 && !message.content
                ? '[Attachment omitted: unsupported by selected model]'
                : message.content,
            attachments: preparedAttachments,
        });

        if (skippedForCapabilities > 0) {
            console.warn(
                `[chat] skipped ${skippedForCapabilities} attachment(s) for provider=${modelConfig.provider} model without required capability`
            );
        }
    }

    return prepared;
}

function buildGoogleContents(messages: PreparedChatMessage[]) {
    return messages.map((message) => {
        const parts: Array<Record<string, unknown>> = [];

        if (message.content) {
            parts.push({ text: message.content });
        }

        for (const attachment of message.attachments) {
            parts.push({
                inlineData: {
                    mimeType: attachment.mimeType,
                    data: attachment.base64Data,
                },
            });
        }

        if (parts.length === 0) {
            parts.push({ text: ' ' });
        }

        return {
            role: message.role === 'assistant' ? 'model' : 'user',
            parts,
        };
    });
}

function buildOpenAICompatibleMessages(messages: PreparedChatMessage[]) {
    return messages.map((message) => {
        if (message.attachments.length === 0) {
            return {
                role: message.role,
                content: message.content,
            };
        }

        const contentParts: Array<Record<string, unknown>> = [];
        if (message.content) {
            contentParts.push({
                type: 'text',
                text: message.content,
            });
        }

        for (const attachment of message.attachments) {
            if (isImageAttachment(attachment.mimeType)) {
                contentParts.push({
                    type: 'image_url',
                    image_url: {
                        url: attachment.dataUrl,
                    },
                });
                continue;
            }

            contentParts.push({
                type: 'file',
                file: {
                    filename: attachment.name,
                    file_data: attachment.dataUrl,
                },
            });
        }

        if (contentParts.length === 0) {
            contentParts.push({ type: 'text', text: ' ' });
        }

        return {
            role: message.role,
            content: contentParts,
        };
    });
}

export async function POST(req: Request) {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const encoder = new TextEncoder();
    const signal = req.signal;

    // Helper to safely enqueue data without crashing if the stream is closed
    const safeEnqueue = (controller: ReadableStreamDefaultController, chunk: string | Uint8Array) => {
        try {
            if (signal.aborted) return;
            const encoded = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
            controller.enqueue(encoded);
        } catch {
            // Ignore closed controller errors
        }
    };

    // Create the stream first so we can return the Response immediately
    const stream = new ReadableStream({
        async start(controller) {
            let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

            if (signal.aborted) return;

            try {
                const body = await req.json();

                // Validate request body with Zod
                const parseResult = ChatRequestSchema.safeParse(body);
                if (!parseResult.success) {
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: 'Invalid request' })}\n\n`);
                    controller.close();
                    return;
                }

                const { messages, model, reasoningEffort } = parseResult.data;
                const modelConfig = AVAILABLE_MODELS.find(m => m.id === model);
                if (!modelConfig) {
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: 'Invalid model selection' })}\n\n`);
                    controller.close();
                    return;
                }

                const limits = await resolveModelLimits(model, modelConfig, signal);
                let trimmedContext = trimMessagesToInputBudget(messages, limits);
                if (trimmedContext.trimmedCount > 0) {
                    console.log(
                        `[chat] context-trimmed model=${model} source=${limits.source} trimmed=${trimmedContext.trimmedCount} ` +
                        `kept=${trimmedContext.messages.length} estTokens=${trimmedContext.estimatedTokens} ` +
                        `inputBudget=${trimmedContext.inputBudget} outputReserve=${trimmedContext.outputReserve} ` +
                        `window=${trimmedContext.contextWindow}`
                    );
                }

                // Start heartbeat to keep connection alive while waiting for AI
                heartbeatInterval = setInterval(() => {
                    safeEnqueue(controller, ': keep-alive\n\n');
                }, 15000);

                const getSourceStream = async (contextMessages: ChatMessage[]) => {
                    const preparedMessages = await prepareMessageAttachments(
                        contextMessages,
                        supabase,
                        user.id,
                        modelConfig,
                        signal
                    );
                    if (modelConfig.provider === 'google') {
                        return getGoogleStream(model, preparedMessages, reasoningEffort ?? 'low', limits.maxOutputTokens, signal);
                    }
                    if (modelConfig.provider === 'openrouter') {
                        return getOpenRouterStream(model, preparedMessages, reasoningEffort ?? 'low', limits.maxOutputTokens, signal);
                    }
                    return getChutesStream(model, preparedMessages, reasoningEffort || 'low', modelConfig, limits.maxOutputTokens, signal);
                };

                let sourceStream: ReadableStream;
                try {
                    sourceStream = await getSourceStream(trimmedContext.messages);
                } catch (error) {
                    const shouldRetry = isContextOverflowError(error);
                    if (!shouldRetry || signal.aborted) {
                        throw error;
                    }

                    const retryContext = trimMessagesToInputBudget(messages, limits, CONTEXT_RETRY_SCALE);
                    const canTighten = retryContext.messages.length < trimmedContext.messages.length
                        || retryContext.inputBudget < trimmedContext.inputBudget;
                    if (!canTighten) {
                        throw error;
                    }

                    console.warn(
                        `[chat] context-overflow model=${model} source=${limits.source} retrying with tighter budget ` +
                        `(inputBudget=${retryContext.inputBudget}, kept=${retryContext.messages.length})`
                    );
                    trimmedContext = retryContext;
                    sourceStream = await getSourceStream(trimmedContext.messages);
                }

                // Clear heartbeat once we have the source stream
                if (heartbeatInterval) clearInterval(heartbeatInterval);

                // Process the stream with robust buffering and thinking-tag transformation
                await processAndTransformStream(sourceStream, controller, signal);

                if (!signal.aborted) {
                    controller.close();
                }
            } catch (error) {
                if (heartbeatInterval) clearInterval(heartbeatInterval);

                // Only log and send errors if the client hasn't already disconnected
                if (!signal.aborted) {
                    console.error('Chat API error:', error);
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: 'AI service error', details: errorMsg })}\n\n`);
                    try { controller.close(); } catch { }
                }
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}

async function getChutesStream(
    model: string,
    messages: PreparedChatMessage[],
    reasoningEffort: ReasoningEffort = 'low',
    modelConfig: ModelConfig,
    maxOutputTokens?: number | null,
    signal?: AbortSignal
) {
    const apiKey = process.env.CHUTES_API_KEY;
    if (!apiKey) throw new Error('Chutes API key missing');

    const requestBody: Record<string, unknown> = {
        model,
        messages: buildOpenAICompatibleMessages(messages),
        stream: true,
        temperature: 1.0,
        top_p: 0.95,
        max_tokens: resolveOutputTokenCap(maxOutputTokens),
    };

    if (reasoningEffort) requestBody.reasoning_effort = reasoningEffort;
    if (modelConfig?.usesThinkingParam) {
        requestBody.chat_template_kwargs = { thinking: reasoningEffort !== 'low' };
    }

    const response = await fetch('https://llm.chutes.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal,
    });

    if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        throw new Error(`Chutes API error ${response.status}: ${responseText || response.statusText}`);
    }
    return response.body as ReadableStream;
}

async function getGoogleStream(
    model: string,
    messages: PreparedChatMessage[],
    reasoningEffort: ReasoningEffort = 'low',
    maxOutputTokens?: number | null,
    signal?: AbortSignal
) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key missing');

    const ai = new GoogleGenAI({ apiKey });
    const contents = buildGoogleContents(messages);

    const config: {
        maxOutputTokens: number;
        thinkingConfig?: {
            includeThoughts: boolean;
            thinkingLevel?: ThinkingLevel;
            thinkingBudget?: number;
        };
    } = { maxOutputTokens: resolveOutputTokenCap(maxOutputTokens) };
    const modelConfig = AVAILABLE_MODELS.find(m => m.id === model);

    if (modelConfig?.supportsReasoning && reasoningEffort) {
        config.thinkingConfig = { includeThoughts: true };
        const isGemini3 = model.includes('gemini-3');
        if (isGemini3) {
            const levelMap: Record<string, ThinkingLevel> = {
                low: ThinkingLevel.LOW,
                medium: ThinkingLevel.MEDIUM,
                high: ThinkingLevel.HIGH
            };
            config.thinkingConfig.thinkingLevel = levelMap[reasoningEffort] || ThinkingLevel.MEDIUM;
        } else {
            const isFlash = model.includes('flash');
            const maxBudget = isFlash ? 24576 : 32768;
            const budgetMap: Record<string, number> = { low: 0, medium: -1, high: maxBudget };
            config.thinkingConfig.thinkingBudget = budgetMap[reasoningEffort] ?? -1;
        }
    }

    const response = await ai.models.generateContentStream({ model, config, contents });

    const encoder = new TextEncoder();
    return new ReadableStream({
        async start(controller) {
            try {
                for await (const chunk of response) {
                    if (signal?.aborted) break;

                    const candidate = chunk.candidates?.[0];
                    if (!candidate?.content?.parts) continue;
                    for (const part of candidate.content.parts) {
                        if (!part.text) continue;
                        const data = JSON.stringify({
                            choices: [{
                                delta: {
                                    content: part.thought ? undefined : part.text,
                                    reasoning_content: part.thought ? part.text : undefined
                                },
                                index: 0,
                                finish_reason: null
                            }]
                        });
                        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                    }
                }
                if (!signal?.aborted) {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                }
            } catch (e) {
                if (!signal?.aborted) {
                    controller.error(e);
                }
            }
        }
    });
}

async function getOpenRouterStream(
    model: string,
    messages: PreparedChatMessage[],
    reasoningEffort: ReasoningEffort = 'low',
    maxOutputTokens?: number | null,
    signal?: AbortSignal
) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OpenRouter API key missing');
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
            'X-Title': 'Pluto Chat',
        },
        body: JSON.stringify({
            model,
            messages: buildOpenAICompatibleMessages(messages),
            stream: true,
            max_tokens: resolveOutputTokenCap(maxOutputTokens),
            reasoning: { effort: reasoningEffort },
        }),
        signal,
    });

    if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        throw new Error(`OpenRouter API error ${response.status}: ${responseText || response.statusText}`);
    }

    return response.body as ReadableStream;
}

/**
 * Processes a source SSE stream, handles chunk buffering to ensure lines aren't broken,
 * and transforms <think> tags into reasoning_content.
 */
async function processAndTransformStream(sourceStream: ReadableStream, controller: ReadableStreamDefaultController, signal?: AbortSignal) {
    const reader = sourceStream.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let isThinking = false;
    let buffer = '';

    const safeEnqueue = (chunk: string | Uint8Array) => {
        try {
            if (signal?.aborted) return;
            const encoded = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
            controller.enqueue(encoded);
        } catch { }
    };

    try {
        while (true) {
            if (signal?.aborted) break;

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // Keep the last partial line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (signal?.aborted) break;

                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                if (!trimmedLine.startsWith('data: ')) {
                    safeEnqueue(line + '\n');
                    continue;
                }

                const dataStr = trimmedLine.slice(6);
                if (dataStr === '[DONE]') {
                    safeEnqueue('data: [DONE]\n\n');
                    continue;
                }

                try {
                    const parsed = JSON.parse(dataStr);
                    const choice = parsed.choices?.[0];
                    const delta = choice?.delta;
                    const content = delta?.content || '';
                    const reasoning = delta?.reasoning_content || delta?.reasoning || delta?.thinking || '';

                    if (content || reasoning) {
                        let newContent = '';
                        let newReasoning = reasoning;
                        let remaining = content;

                        while (remaining.length > 0) {
                            if (!isThinking) {
                                const thinkStartIdx = remaining.indexOf('<think>');
                                if (thinkStartIdx !== -1) {
                                    newContent += remaining.slice(0, thinkStartIdx);
                                    isThinking = true;
                                    remaining = remaining.slice(thinkStartIdx + 7);
                                } else {
                                    newContent += remaining;
                                    remaining = '';
                                }
                            } else {
                                const thinkEndIdx = remaining.indexOf('</think>');
                                if (thinkEndIdx !== -1) {
                                    newReasoning += remaining.slice(0, thinkEndIdx);
                                    isThinking = false;
                                    remaining = remaining.slice(thinkEndIdx + 8);
                                } else {
                                    newReasoning += remaining;
                                    remaining = '';
                                }
                            }
                        }

                        const transformedData = JSON.stringify({
                            ...parsed,
                            choices: [{
                                ...choice,
                                delta: {
                                    ...delta,
                                    content: newContent || undefined,
                                    reasoning_content: newReasoning || undefined
                                }
                            }]
                        });
                        safeEnqueue(`data: ${transformedData}\n\n`);
                    } else {
                        // Pass through non-content chunks (reasoning, metadata)
                        safeEnqueue(`data: ${dataStr}\n\n`);
                    }
                } catch {
                    safeEnqueue(line + '\n');
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

