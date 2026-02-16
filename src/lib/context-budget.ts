import type { PreparedChatMessage } from '@/lib/chat-attachments';
import type { ResolvedModelLimits } from '@/lib/providers/model-limits';
import type { ChatMessage } from '@/lib/types';

import { resolveOutputTokenCap } from '@/lib/providers/model-limits';

const DEFAULT_SAFETY_MARGIN_TOKENS = 2048;
const MIN_INPUT_BUDGET_TOKENS = 2048;

export const CONTEXT_RETRY_SCALE = 0.7;

export interface TrimmedContext {
    messages: ChatMessage[];
    trimmedCount: number;
    estimatedTokens: number;
    inputBudget: number;
    contextWindow: number;
    outputReserve: number;
}

export interface OutputTokenPlan {
    requestedOutputTokens: number;
    requestMaxTokens: number;
    promptTokenEstimate: number;
    remainingForOutput: number;
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

function estimatePreparedMessageTokens(message: PreparedChatMessage) {
    const attachmentCount = message.attachments?.length ?? 0;
    const attachmentBudget = attachmentCount * 1200;
    return Math.ceil(message.content.length / 3.5) + 8 + attachmentBudget;
}

export function estimatePreparedConversationTokens(messages: PreparedChatMessage[]) {
    return messages.reduce((sum, message) => sum + estimatePreparedMessageTokens(message), 0);
}

export function estimateSystemPromptTokens(systemPrompt: string) {
    if (!systemPrompt) return 0;
    const trimmed = systemPrompt.trim();
    if (!trimmed) return 0;
    return Math.ceil(trimmed.length / 3.5) + 8;
}

export function resolveOutputTokenPlan(
    limits: ResolvedModelLimits,
    maxOutputTokens: number | null | undefined,
    promptTokenEstimate: number
): OutputTokenPlan {
    const requestedOutputTokens = resolveOutputTokenCap(maxOutputTokens);
    const remainingForOutput = limits.contextWindowTokens - promptTokenEstimate - DEFAULT_SAFETY_MARGIN_TOKENS;
    const requestMaxTokens = Math.max(1, Math.min(requestedOutputTokens, remainingForOutput));
    return {
        requestedOutputTokens,
        requestMaxTokens,
        promptTokenEstimate,
        remainingForOutput,
    };
}

function resolveTrimOutputReserve(
    limits: ResolvedModelLimits,
    maxOutputTokens: number | null | undefined,
    reservedInputTokens: number
) {
    const requestedOutputTokens = resolveOutputTokenCap(maxOutputTokens);
    const reserved = Math.max(0, Math.floor(reservedInputTokens));
    const maxReserveByWindow = Math.max(
        512,
        limits.contextWindowTokens - DEFAULT_SAFETY_MARGIN_TOKENS - reserved - MIN_INPUT_BUDGET_TOKENS
    );
    return Math.max(512, Math.min(requestedOutputTokens, maxReserveByWindow));
}

function findLastUserIndex(messages: ChatMessage[]) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') return i;
    }
    return -1;
}

export function trimMessagesToInputBudget(
    messages: ChatMessage[],
    limits: ResolvedModelLimits,
    budgetScale: number = 1,
    reservedInputTokens: number = 0
): TrimmedContext {
    const outputReserve = resolveTrimOutputReserve(limits, limits.maxOutputTokens, reservedInputTokens);
    const reserved = Math.max(0, Math.floor(reservedInputTokens));
    const availableInputBudget = Math.max(
        0,
        limits.contextWindowTokens - outputReserve - DEFAULT_SAFETY_MARGIN_TOKENS - reserved
    );
    const normalizedScale = Math.min(1, Math.max(0.2, budgetScale));
    const scaledInputBudget = Math.floor(availableInputBudget * normalizedScale);
    const inputBudget = availableInputBudget <= 0
        ? 0
        : Math.max(1, Math.min(availableInputBudget, Math.max(MIN_INPUT_BUDGET_TOKENS, scaledInputBudget)));

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

export function isContextOverflowError(error: unknown) {
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
