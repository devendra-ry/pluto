import assert from 'node:assert';
import { test } from 'node:test';

process.env.NODE_ENV = 'production';
process.env.GEMINI_API_KEY = 'dummy-key';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-key';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

test('production rate limiting fails closed without Redis', async () => {
    const { ApiRequestError } = await import('../src/server/http/api-security');
    const { SimpleRateLimiter, assertRateLimit } = await import('../src/server/http/rate-limit');
    const limiter = new SimpleRateLimiter(10, 60_000, { scope: 'production-test' });

    await assert.rejects(
        assertRateLimit('user-1', limiter),
        (error: unknown) => error instanceof ApiRequestError && error.status === 503,
    );
});
