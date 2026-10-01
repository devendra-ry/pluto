import assert from 'node:assert';
import { test } from 'node:test';

import { executeSoftDelete, restoreMessagesForFailedDelete } from './message-mutations';

test('failed delete rollback restores its IDs without replacing concurrent cache changes', () => {
    const message = (id: string) => ({
        id,
        thread_id: 'thread',
        role: 'user' as const,
        content: id,
        created_at: `2026-01-01T00:00:0${id}Z`,
    });
    const previous = [message('1'), message('2'), message('3')];
    const current = [message('3'), { ...message('4'), content: 'new realtime message' }];

    const restored = restoreMessagesForFailedDelete(current, previous, ['1']);

    assert.deepEqual(restored.map(({ id }) => id), ['1', '3', '4']);
    assert.equal(restored[2]?.content, 'new realtime message');
});

test('executeSoftDelete rolls back Supabase response errors and keeps their message', async () => {
    let rollbackCount = 0;

    await assert.rejects(
        executeSoftDelete(
            async () => ({ error: { message: 'policy rejected delete' } }),
            () => { rollbackCount += 1; },
        ),
        /Soft-delete failed \(policy rejected delete\)/,
    );

    assert.equal(rollbackCount, 1);
});

test('executeSoftDelete rolls back and rethrows a rejected RPC unchanged', async () => {
    let rollbackCount = 0;
    const networkError = new Error('connection lost');

    await assert.rejects(
        executeSoftDelete(
            async () => { throw networkError; },
            () => { rollbackCount += 1; },
        ),
        (error: unknown) => error === networkError,
    );

    assert.equal(rollbackCount, 1);
});
