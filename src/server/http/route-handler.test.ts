import { describe, test } from 'node:test';
import assert from 'node:assert';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

async function getProtectionCheck() {
    return (await import('./route-handler')).assertApiRequestProtection;
}

describe('assertApiRequestProtection', () => {
    test('starts the block and rate checks concurrently', async () => {
        const assertApiRequestProtection = await getProtectionCheck();
        let active = 0;
        let maxActive = 0;
        let blockedCalls = 0;
        let rateLimitCalls = 0;

        const delayedCheck = async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 15));
            active -= 1;
        };

        await assertApiRequestProtection('user-1', {} as never, {
            assertNotBlocked: async (userId, scope) => {
                blockedCalls += 1;
                assert.equal(userId, 'user-1');
                assert.equal(scope, 'api');
                await delayedCheck();
            },
            assertRateLimit: async (userId) => {
                rateLimitCalls += 1;
                assert.equal(userId, 'user-1');
                await delayedCheck();
            },
        });

        assert.equal(blockedCalls, 1);
        assert.equal(rateLimitCalls, 1);
        assert.equal(maxActive, 2);
    });

    test('preserves block failure precedence when both checks reject', async () => {
        const assertApiRequestProtection = await getProtectionCheck();
        const blockError = new Error('blocked');
        const rateLimitError = new Error('rate limited');

        await assert.rejects(
            assertApiRequestProtection('user-1', {} as never, {
                assertNotBlocked: async () => { throw blockError; },
                assertRateLimit: async () => { throw rateLimitError; },
            }),
            (error: unknown) => error === blockError,
        );
    });

    test('returns a block failure without waiting for an in-flight rate check', async () => {
        const assertApiRequestProtection = await getProtectionCheck();
        const blockError = new Error('blocked');
        let rateLimitStarted = false;

        await assert.rejects(
            assertApiRequestProtection('user-1', {} as never, {
                assertNotBlocked: async () => { throw blockError; },
                assertRateLimit: async () => {
                    rateLimitStarted = true;
                    await new Promise(() => undefined);
                },
            }),
            (error: unknown) => error === blockError,
        );

        assert.equal(rateLimitStarted, true);
    });

    test('does not run a rate check when no limiter is configured', async () => {
        const assertApiRequestProtection = await getProtectionCheck();
        let rateLimitCalls = 0;

        await assertApiRequestProtection('user-1', undefined, {
            assertNotBlocked: async () => undefined,
            assertRateLimit: async () => { rateLimitCalls += 1; },
        });

        assert.equal(rateLimitCalls, 0);
    });
});
