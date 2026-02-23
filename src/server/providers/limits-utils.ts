const DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS = 65536;
const DEBUG_MODEL_LIMITS = process.env.CHAT_DEBUG_MODEL_LIMITS === '1';

export function toPositiveInt(value: unknown): number | null {
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

export function resolveOutputTokenCap(maxOutputTokens: number | null | undefined) {
    const parsed = toPositiveInt(maxOutputTokens);
    return parsed ?? DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS;
}

export function logModelLimits(label: string, payload: Record<string, unknown>) {
    if (!DEBUG_MODEL_LIMITS) return;
    try {
        console.log(`[chat][limits] ${label} ${JSON.stringify(payload)}`);
    } catch {
        console.log(`[chat][limits] ${label}`);
    }
}