export function readPositiveInt(value: string | undefined, fallback: number): number {
    const normalized = value?.trim();
    // parseInt accepts partial values (for example, "12ms" and "1.5") which
    // silently turn malformed environment configuration into a different value.
    if (!normalized || !/^\d+$/.test(normalized)) return fallback;

    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
    return parsed;
}
