import { before, describe, test } from 'node:test';
import assert from 'node:assert';

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'dummy-key';
process.env.GEMINI_API_KEY ??= 'dummy-key';

import type { ResolvedModelLimits } from '@/server/providers/provider-types';
import type { ChatMessage } from '@/shared/core/types';

let trimMessagesToInputBudget: typeof import('./context-budget').trimMessagesToInputBudget;

before(async () => {
    ({ trimMessagesToInputBudget } = await import('./context-budget'));
});

const limits: ResolvedModelLimits = {
    contextWindowTokens: 3000,
    maxOutputTokens: 100,
    source: 'fallback',
};

function message(role: ChatMessage['role'], contentLength: number): ChatMessage {
    return { role, content: 'a'.repeat(contentLength) };
}

describe('trimMessagesToInputBudget', () => {
    test('keeps the newest messages when everything fits', () => {
        const messages = [message('user', 10), message('assistant', 10)];
        const result = trimMessagesToInputBudget(messages, limits);

        assert.strictEqual(result.trimmedCount, 0);
        assert.strictEqual(result.messages.length, 2);
    });

    test('never returns a window that starts with an assistant turn', () => {
        // Budget fits [assistant, user, assistant] but not the first big
        // user message — the window must advance to the next user turn.
        const messages = [
            message('user', 2000),
            message('assistant', 200),
            message('user', 20),
            message('assistant', 20),
        ];
        const result = trimMessagesToInputBudget(messages, limits);

        assert.ok(result.messages.length > 0);
        assert.strictEqual(result.messages.at(0)?.role, 'user');
    });

    test('falls back to the last message for assistant-only input', () => {
        const messages = [message('assistant', 50), message('assistant', 50)];
        const result = trimMessagesToInputBudget(messages, limits);

        assert.strictEqual(result.messages.length, 1);
    });
});
