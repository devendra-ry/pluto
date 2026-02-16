import 'server-only';

import { publicEnv } from '@/lib/env/public';

function requireServerEnv(name: string, value: string | undefined) {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error(`[env] Missing required environment variable: ${name}`);
    }
    return normalized;
}

function optionalServerEnv(value: string | undefined) {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
}

export const serverEnv = Object.freeze({
    ...publicEnv,
    GEMINI_API_KEY: requireServerEnv('GEMINI_API_KEY', process.env.GEMINI_API_KEY),
    OPENROUTER_API_KEY: optionalServerEnv(process.env.OPENROUTER_API_KEY),
    CHUTES_API_KEY: optionalServerEnv(process.env.CHUTES_API_KEY),
    CHUTES_API_TOKEN: optionalServerEnv(process.env.CHUTES_API_TOKEN),
});

