import { type SupabaseClient, type User } from '@supabase/supabase-js';
import { assertJsonRequest, assertValidPostOrigin, requireUser, toJsonErrorResponse } from '@/utils/api-security';
import { assertRateLimit, type SimpleRateLimiter } from '@/utils/rate-limit';
import { assertNotTemporarilyBlocked, recordAbuseSignal } from '@/server/security/abuse-protection';

export interface AuthenticatedContext {
    user: User;
    supabase: SupabaseClient;
}

export async function withSecureContext(
    req: Request,
    handler: (context: AuthenticatedContext) => Promise<Response>,
    rateLimiter?: SimpleRateLimiter
): Promise<Response> {
    let userId: string | null = null;
    try {
        assertValidPostOrigin(req);
        assertJsonRequest(req);

        const { user, supabase } = await requireUser();
        userId = user.id;
        await assertNotTemporarilyBlocked(user.id, 'api');

        if (rateLimiter) {
            try {
                await assertRateLimit(user.id, rateLimiter);
            } catch (error) {
                await recordAbuseSignal(user.id, 'ratelimit', 'rate-limit');
                throw error;
            }
        }

        return await handler({ user, supabase });
    } catch (error) {
        if (userId) {
            const message = error instanceof Error ? error.message.toLowerCase() : '';
            if (message.includes('too many requests') || message.includes('rate')) {
                await recordAbuseSignal(userId, 'api', 'too-many-requests');
            }
        }

        const response = toJsonErrorResponse(error);
        if (response) {
            return response;
        }

        if (userId) {
            await recordAbuseSignal(userId, 'api', 'internal-error');
        }

        console.error('API Error:', error);

        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
