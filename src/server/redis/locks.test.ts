import assert from 'node:assert/strict';
import test from 'node:test';

Object.defineProperty(process.env, 'NODE_ENV', {
    value: 'production',
    configurable: true,
    enumerable: true,
    writable: true,
});
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

test('generation locks fail closed in production when Redis is unavailable', async () => {
    const { acquireScopedSlotsLock } = await import('./locks');
    await assert.rejects(
        acquireScopedSlotsLock('image', 'user-1', 1),
        /Distributed generation locking is unavailable/,
    );
});
