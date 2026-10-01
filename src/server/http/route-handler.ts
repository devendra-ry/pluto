import 'server-only';

import { logger } from '@/server/logging/logger';

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

type ApiProtectionChecks = {
    assertNotBlocked: typeof assertNotTemporarilyBlocked;
    assertRateLimit: typeof assertRateLimit;
};

/**
 * Run independent per-user protections together after authentication. Prefer
 * the block result when both checks fail to retain the old error precedence.
 */
export async function assertApiRequestProtection(
    userId: string,
    rateLimiter?: SimpleRateLimiter,
    checks: ApiProtectionChecks = {
        assertNotBlocked: assertNotTemporarilyBlocked,
        assertRateLimit,
    },
) {
    const rateLimitResult = rateLimiter
        ? checks.assertRateLimit(userId, rateLimiter).then(
            () => ({ status: 'fulfilled' as const }),
            (reason: unknown) => ({ status: 'rejected' as const, reason }),
        )
        : null;

    // Await the block check first to preserve its error priority and fast
    // rejection behavior, while the independent rate check runs at the same time.
    await checks.assertNotBlocked(userId, 'api');
    if (rateLimitResult) {
        const result = await rateLimitResult;
        if (result.status === 'rejected') throw result.reason;
    }
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
        await assertApiRequestProtection(user.id, rateLimiter);

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

        logger.error('API Error:', error);

        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
