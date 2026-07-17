import assert from 'node:assert';
import { test } from 'node:test';

import {
    buildBranchMessageRows,
    buildBranchTitle,
    selectMessagesThroughBranch,
} from './branch-plan';
import type { ChatViewMessage } from '@/shared/contracts/chat';

const messages: ChatViewMessage[] = [
    { id: 'm1', role: 'user', content: 'First' },
    { id: 'm2', role: 'assistant', content: 'Second', reasoning: 'Thought' },
    { id: 'm3', role: 'user', content: 'Third' },
];

test('branch planning', async (t) => {
    await t.test('selects messages through the branch point', () => {
        assert.deepStrictEqual(
            selectMessagesThroughBranch(messages, 'm2').map((message) => message.id),
            ['m1', 'm2'],
        );
    });

    await t.test('rejects an unknown branch point', () => {
        assert.throws(
            () => selectMessagesThroughBranch(messages, 'missing'),
            /Selected message not found/,
        );
    });

    await t.test('builds bounded branch titles', () => {
        assert.strictEqual(buildBranchTitle('New Chat'), 'New Chat');
        assert.strictEqual(buildBranchTitle('Original'), 'Branch of Original');
        assert.ok(buildBranchTitle('x'.repeat(100)).length <= 50);
    });

    await t.test('preserves source timestamps when building rows', () => {
        const rows = buildBranchMessageRows(
            messages.slice(0, 2),
            'new-thread',
            'user-1',
            new Map([['m1', '2026-01-01T00:00:00.000Z']]),
            '2026-02-01T00:00:00.000Z',
        );
        assert.strictEqual(rows[0].created_at, '2026-01-01T00:00:00.000Z');
        assert.strictEqual(rows[1].created_at, '2026-02-01T00:00:00.000Z');
        assert.strictEqual(rows[1].reasoning, 'Thought');
    });
});
