import 'server-only';

import { type SupabaseClient, type User } from '@supabase/supabase-js';
import {
    assertContentLengthWithinLimit,
    assertJsonRequest,
    assertValidPostOrigin,
    requireUser,
    toJsonErrorResponse,
} from '@/server/http/api-security';
import { assertRateLimit, type SimpleRateLimiter } from '@/server/http/rate-limit';
import { assertNotTemporarilyBlocked, recordAbuseSignal } from '@/server/security/abuse-protection';
import { MAX_JSON_REQUEST_BYTES } from '@/shared/validation/request-limits';

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
        assertContentLengthWithinLimit(req, MAX_JSON_REQUEST_BYTES);

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
