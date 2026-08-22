import 'server-only';

import { publicEnv } from '@/shared/config/public';

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

export function readOptionalServerEnv(name: string) {
    return optionalServerEnv(process.env[name]);
}

export function readFirstOptionalServerEnv(...names: string[]) {
    for (const name of names) {
        const value = readOptionalServerEnv(name);
        if (value) return value;
    }
    return undefined;
}

export const serverEnv = Object.freeze({
    ...publicEnv,
    GEMINI_API_KEY: requireServerEnv('GEMINI_API_KEY', process.env.GEMINI_API_KEY),
    APP_URL: optionalServerEnv(process.env.APP_URL),
    VERCEL_URL: optionalServerEnv(process.env.VERCEL_URL),
    SUPABASE_ATTACHMENTS_BUCKET: optionalServerEnv(process.env.SUPABASE_ATTACHMENTS_BUCKET),
    NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET: optionalServerEnv(process.env.NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET),
});
