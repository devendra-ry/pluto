import 'server-only';

export function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizePotentialBase64(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const dataUrlMatch = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
    return dataUrlMatch?.[1]?.trim() || trimmed;
}

export function readStringOrFirst(value: unknown) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return '';
}

export function toBoundedInteger(value: unknown, fallback: number, min: number, max: number) {
    const candidate = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(candidate)) return fallback;
    return Math.min(max, Math.max(min, Math.round(candidate)));
}

export function toBoundedNumber(value: unknown, fallback: number, min: number, max: number) {
    const candidate = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(candidate)) return fallback;
    return Math.min(max, Math.max(min, candidate));
}
