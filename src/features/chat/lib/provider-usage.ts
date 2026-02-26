export interface ProviderUsage {
    outputTokens: number;
    inputTokens?: number;
    totalTokens?: number;
    source: 'provider';
}

function readNonNegativeInt(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
    return Math.floor(value);
}

function parseUsageRecord(usage: Record<string, unknown>): ProviderUsage | null {
    const inputTokens =
        readNonNegativeInt(usage.inputTokens) ??
        readNonNegativeInt(usage.prompt_tokens) ??
        readNonNegativeInt(usage.promptTokenCount) ??
        readNonNegativeInt(usage.tokens_prompt) ??
        readNonNegativeInt(usage.native_tokens_prompt);
    let outputTokens =
        readNonNegativeInt(usage.outputTokens) ??
        readNonNegativeInt(usage.completion_tokens) ??
        readNonNegativeInt(usage.candidatesTokenCount) ??
        readNonNegativeInt(usage.tokens_completion) ??
        readNonNegativeInt(usage.native_tokens_completion);
    const totalTokens =
        readNonNegativeInt(usage.totalTokens) ??
        readNonNegativeInt(usage.total_tokens) ??
        readNonNegativeInt(usage.totalTokenCount);

    if (outputTokens === undefined && inputTokens !== undefined && totalTokens !== undefined) {
        const inferred = totalTokens - inputTokens;
        if (inferred >= 0) outputTokens = inferred;
    }
    if (outputTokens === undefined) return null;

    return { outputTokens, inputTokens, totalTokens, source: 'provider' };
}

export function parseProviderUsage(value: unknown): ProviderUsage | null {
    if (!value || typeof value !== 'object') return null;

    const parsed = value as Record<string, unknown>;
    const typedData = (
        parsed.type === 'data-usage'
        && parsed.data
        && typeof parsed.data === 'object'
    )
        ? parsed.data as Record<string, unknown>
        : null;
    const normalizedUsage = (
        parsed.meta === 'usage'
        && parsed.usage
        && typeof parsed.usage === 'object'
    )
        ? parsed.usage as Record<string, unknown>
        : null;

    const usage = typedData
        ?? normalizedUsage
        ?? ((parsed.usage && typeof parsed.usage === 'object') ? parsed.usage as Record<string, unknown> : null)
        ?? ((parsed.usageMetadata && typeof parsed.usageMetadata === 'object') ? parsed.usageMetadata as Record<string, unknown> : null)
        // OpenRouter can emit usage at top-level.
        ?? parsed;

    if (!usage || typeof usage !== 'object') return null;
    return parseUsageRecord(usage);
}
