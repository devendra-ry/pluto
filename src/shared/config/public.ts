function requirePublicEnv(name: string, value: string | undefined) {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error(`[env] Missing required environment variable: ${name}`);
    }
    return normalized;
}

function optionalPublicEnv(value: string | undefined) {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
}

export const publicEnv = Object.freeze({
    NEXT_PUBLIC_SUPABASE_URL: requirePublicEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: requirePublicEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    NEXT_PUBLIC_APP_URL: optionalPublicEnv(process.env.NEXT_PUBLIC_APP_URL),
});