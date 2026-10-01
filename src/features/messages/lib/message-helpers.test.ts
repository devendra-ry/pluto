import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mergeMessagesSorted, toMessage, type Message } from './message-helpers';

describe('message-helpers', () => {
    const baseMessage: Message = {
        id: '1',
        thread_id: 't1',
        role: 'user',
        content: 'hello',
        created_at: '2023-01-01T10:00:00Z',
        attachments: [],
        deleted_at: null
    };

    describe('mergeMessagesSorted', () => {
        test('merges and sorts messages', () => {
             const existing = [{ ...baseMessage, id: '1', created_at: '2023-01-01T10:00:00Z' }];
             const incoming = [{ ...baseMessage, id: '2', created_at: '2023-01-01T11:00:00Z' }];

             const merged = mergeMessagesSorted(existing, incoming);
             assert.strictEqual(merged.length, 2);
             assert.strictEqual(merged.at(0)?.id, '1');
             assert.strictEqual(merged.at(1)?.id, '2');
        });

        test('updates existing messages', () => {
             const existing = [{ ...baseMessage, id: '1', content: 'old' }];
             const incoming = [{ ...baseMessage, id: '1', content: 'new' }];

             const merged = mergeMessagesSorted(existing, incoming);
             assert.strictEqual(merged.length, 1);
             assert.strictEqual(merged.at(0)?.content, 'new');
        });

        test('inserts out-of-order realtime messages and breaks timestamp ties by id', () => {
            const existing = [
                { ...baseMessage, id: '1' },
                { ...baseMessage, id: '3' },
            ];
            const merged = mergeMessagesSorted(existing, [{ ...baseMessage, id: '2' }]);
            assert.deepStrictEqual(merged.map((message) => message.id), ['1', '2', '3']);
            assert.strictEqual(merged[0], existing[0]);
            assert.deepStrictEqual(existing.map((message) => message.id), ['1', '3']);
        });

        test('repositions an updated row when its timestamp changes', () => {
            const existing = [
                { ...baseMessage, id: '1' },
                { ...baseMessage, id: '2', created_at: '2023-01-01T11:00:00Z' },
            ];
            const merged = mergeMessagesSorted(existing, [{ ...existing[0]!, created_at: '2023-01-01T12:00:00Z' }]);
            assert.deepStrictEqual(merged.map((message) => message.id), ['2', '1']);
        });

        test('normalizes unsorted history and keeps the last incoming row per id', () => {
            const existing = [{ ...baseMessage, id: '3' }, { ...baseMessage, id: '1' }];
            assert.deepStrictEqual(
                mergeMessagesSorted(existing, [{ ...baseMessage, id: '2' }]).map((message) => message.id),
                ['1', '2', '3'],
            );
            const merged = mergeMessagesSorted(existing, [
                { ...baseMessage, id: '2', content: 'first' },
                { ...baseMessage, id: '2', content: 'last' },
            ]);
            assert.strictEqual(merged[1]?.content, 'last');
        });

        test('retains the cache reference for an identical row', () => {
            const existing = [baseMessage];
            assert.strictEqual(mergeMessagesSorted(existing, [baseMessage]), existing);
        });
    });

    describe('toMessage', () => {
        test('converts valid object to Message', () => {
            const input = {
                id: '1',
                thread_id: 't1',
                role: 'user',
                content: 'hello',
                created_at: '2023-01-01T10:00:00Z',
                attachments: [],
                deleted_at: null
            };
            const message = toMessage(input);
            // We expect toMessage to process attachments and other fields,
            // but since input matches the expected output structure here (attachments is array), it should match.
            // Note: toMessage calls attachmentsFromUnknown.
            // Let's refine the test to be more precise about undefined fields becoming defaults.
            assert.strictEqual(message?.id, '1');
            assert.strictEqual(message?.content, 'hello');
        });

        test('returns null for invalid input', () => {
            assert.strictEqual(toMessage(null), null);
            assert.strictEqual(toMessage({}), null);
            assert.strictEqual(toMessage({ id: '1' }), null); // missing fields
        });

        test('retains provider reasoning usage when hydrating a saved reply', () => {
            const message = toMessage({
                ...baseMessage,
                reply_stats: { outputTokens: 10, reasoningTokens: 20, seconds: 2, tokensPerSecond: 15, source: 'provider' },
            });
            assert.strictEqual(message?.reply_stats?.reasoningTokens, 20);
            assert.strictEqual(message?.reply_stats?.outputTokens, 10);
        });
    });
});
