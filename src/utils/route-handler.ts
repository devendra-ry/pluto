import { type SupabaseClient, type User } from '@supabase/supabase-js';
import { assertJsonRequest, assertValidPostOrigin, requireUser, toJsonErrorResponse } from '@/utils/api-security';
import { assertRateLimit, type SimpleRateLimiter } from '@/utils/rate-limit';

export interface AuthenticatedContext {
    user: User;
    supabase: SupabaseClient;
}

export async function withSecureContext(
    req: Request,
    handler: (context: AuthenticatedContext) => Promise<Response>,
    rateLimiter?: SimpleRateLimiter
): Promise<Response> {
    try {
        assertValidPostOrigin(req);
        assertJsonRequest(req);

        const { user, supabase } = await requireUser();

        if (rateLimiter) {
            await assertRateLimit(user.id, rateLimiter);
        }

        return await handler({ user, supabase });
    } catch (error) {
        const response = toJsonErrorResponse(error);
        if (response) {
            return response;
        }

        console.error('API Error:', error);

        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}