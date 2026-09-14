import assert from 'node:assert';
import { test } from 'node:test';

import {
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

});
