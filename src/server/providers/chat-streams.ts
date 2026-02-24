import { GoogleGenAI, ThinkingLevel } from '@google/genai';

import { isImageAttachment } from '@/features/attachments';
import { CHUTES_MISSING_API_KEY_MESSAGE, getChutesApiKey } from '@/server/providers/chutes';
import { AVAILABLE_MODELS, type ModelConfig } from '@/shared/core/constants';
import { serverEnv } from '@/shared/config/server';
import type { PreparedChatMessage } from '@/features/chat/server';
import { logModelLimits, resolveOutputTokenCap } from '@/server/providers/limits-utils';
import type { RequestTokenEstimates } from '@/server/providers/provider-types';
import type { ReasoningEffort } from '@/shared/core/types';

/** Module-level singleton — TextEncoder is stateless. */
const sharedEncoder = new TextEncoder();

export function buildGoogleContents(messages: PreparedChatMessage[]) {
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

export function buildOpenAICompatibleMessages(messages: PreparedChatMessage[], systemPrompt?: string) {
    const prepared = messages.map((message) => {
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
            const dataUrl = `data:${attachment.mimeType};base64,${attachment.base64Data}`;
            if (isImageAttachment(attachment.mimeType)) {
                contentParts.push({
                    type: 'image_url',
                    image_url: {
                        url: dataUrl,
                    },
                });
                continue;
            }

            contentParts.push({
                type: 'file',
                file: {
                    filename: attachment.name,
                    file_data: dataUrl,
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

    if (systemPrompt && systemPrompt.trim().length > 0) {
        return [
            { role: 'system', content: systemPrompt.trim() },
            ...prepared,
        ];
    }
    return prepared;
}

export async function getChutesStream(
    model: string,
    messages: PreparedChatMessage[],
    reasoningEffort: ReasoningEffort = 'low',
    modelConfig: ModelConfig,
    maxOutputTokens?: number | null,
    systemPrompt?: string,
    tokenEstimates?: RequestTokenEstimates,
    signal?: AbortSignal
) {
    const apiKey = getChutesApiKey();
    if (!apiKey) throw new Error(CHUTES_MISSING_API_KEY_MESSAGE);

    const requestBody: Record<string, unknown> = {
        model,
        messages: buildOpenAICompatibleMessages(messages, systemPrompt),
        stream: true,
        temperature: 1.0,
        top_p: 0.95,
        max_tokens: resolveOutputTokenCap(maxOutputTokens),
    };

    logModelLimits('chutes-request', {
        model,
        resolvedMaxOutputTokens: maxOutputTokens,
        requestMaxTokens: requestBody.max_tokens,
        messageCount: messages.length,
        estimatedInputTokens: tokenEstimates?.estimatedInputTokens,
        estimatedInputTokensWithSystemPrompt: tokenEstimates?.estimatedInputTokensWithSystemPrompt,
    });

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

export async function getGoogleStream(
    model: string,
    messages: PreparedChatMessage[],
    reasoningEffort: ReasoningEffort = 'low',
    maxOutputTokens?: number | null,
    systemPrompt?: string,
    useSearch: boolean = false,
    tokenEstimates?: RequestTokenEstimates,
    signal?: AbortSignal
) {
    const ai = new GoogleGenAI({ apiKey: serverEnv.GEMINI_API_KEY });
    const contents = buildGoogleContents(messages);

    const config: {
        maxOutputTokens: number;
        thinkingConfig?: {
            includeThoughts: boolean;
            thinkingLevel?: ThinkingLevel;
            thinkingBudget?: number;
        };
        tools?: Array<{ googleSearch: Record<string, never> }>;
        systemInstruction?: string;
    } = { maxOutputTokens: resolveOutputTokenCap(maxOutputTokens) };
    logModelLimits('google-request', {
        model,
        resolvedMaxOutputTokens: maxOutputTokens,
        requestMaxOutputTokens: config.maxOutputTokens,
        messageCount: messages.length,
        useSearch,
        estimatedInputTokens: tokenEstimates?.estimatedInputTokens,
        estimatedInputTokensWithSystemPrompt: tokenEstimates?.estimatedInputTokensWithSystemPrompt,
    });
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

    if (useSearch) {
        config.tools = [{ googleSearch: {} }];
    }
    if (systemPrompt && systemPrompt.trim().length > 0) {
        config.systemInstruction = systemPrompt.trim();
    }

    const response = await ai.models.generateContentStream({ model, config, contents });
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
                        controller.enqueue(sharedEncoder.encode(`data: ${data}\n\n`));
                    }
                }
                if (!signal?.aborted) {
                    controller.enqueue(sharedEncoder.encode('data: [DONE]\n\n'));
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

export async function getOpenRouterStream(
    model: string,
    messages: PreparedChatMessage[],
    reasoningEffort: ReasoningEffort = 'low',
    maxOutputTokens?: number | null,
    systemPrompt?: string,
    tokenEstimates?: RequestTokenEstimates,
    signal?: AbortSignal
) {
    const apiKey = serverEnv.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OpenRouter API key missing');
    const requestMaxTokens = resolveOutputTokenCap(maxOutputTokens);
    logModelLimits('openrouter-request', {
        model,
        resolvedMaxOutputTokens: maxOutputTokens,
        requestMaxTokens,
        messageCount: messages.length,
        estimatedInputTokens: tokenEstimates?.estimatedInputTokens,
        estimatedInputTokensWithSystemPrompt: tokenEstimates?.estimatedInputTokensWithSystemPrompt,
    });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': serverEnv.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
            'X-Title': 'Pluto Chat',
        },
        body: JSON.stringify({
            model,
            messages: buildOpenAICompatibleMessages(messages, systemPrompt),
            stream: true,
            max_tokens: requestMaxTokens,
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