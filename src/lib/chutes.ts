export const CHUTES_MISSING_API_KEY_MESSAGE = 'Chutes API key missing (set CHUTES_API_KEY or CHUTES_API_TOKEN)';

export function getChutesApiKey() {
    const fromPrimary = process.env.CHUTES_API_KEY?.trim();
    if (fromPrimary) return fromPrimary;
    const fromToken = process.env.CHUTES_API_TOKEN?.trim();
    return fromToken || null;
}
