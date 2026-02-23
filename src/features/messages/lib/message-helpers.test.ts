import { test, describe } from 'node:test';
import assert from 'node:assert';
import { sortMessagesByCreatedAt, mergeMessagesSorted, removeMessagesById, toMessage, type Message } from './message-helpers';

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

    describe('sortMessagesByCreatedAt', () => {
        test('sorts messages by created_at', () => {
            const m1 = { ...baseMessage, id: '1', created_at: '2023-01-01T10:00:00Z' };
            const m2 = { ...baseMessage, id: '2', created_at: '2023-01-01T11:00:00Z' };
            const m3 = { ...baseMessage, id: '3', created_at: '2023-01-01T09:00:00Z' };

            const sorted = sortMessagesByCreatedAt([m1, m2, m3]);
            assert.deepStrictEqual(sorted, [m3, m1, m2]);
        });

        test('sorts messages by id if created_at is equal', () => {
             const m1 = { ...baseMessage, id: 'b', created_at: '2023-01-01T10:00:00Z' };
             const m2 = { ...baseMessage, id: 'a', created_at: '2023-01-01T10:00:00Z' };

             const sorted = sortMessagesByCreatedAt([m1, m2]);
             assert.deepStrictEqual(sorted, [m2, m1]);
        });
    });

    describe('mergeMessagesSorted', () => {
        test('merges and sorts messages', () => {
             const existing = [{ ...baseMessage, id: '1', created_at: '2023-01-01T10:00:00Z' }];
             const incoming = [{ ...baseMessage, id: '2', created_at: '2023-01-01T11:00:00Z' }];

             const merged = mergeMessagesSorted(existing, incoming);
             assert.strictEqual(merged.length, 2);
             assert.strictEqual(merged[0].id, '1');
             assert.strictEqual(merged[1].id, '2');
        });

        test('updates existing messages', () => {
             const existing = [{ ...baseMessage, id: '1', content: 'old' }];
             const incoming = [{ ...baseMessage, id: '1', content: 'new' }];

             const merged = mergeMessagesSorted(existing, incoming);
             assert.strictEqual(merged.length, 1);
             assert.strictEqual(merged[0].content, 'new');
        });
    });

    describe('removeMessagesById', () => {
        test('removes messages by id', () => {
            const existing = [
                { ...baseMessage, id: '1' },
                { ...baseMessage, id: '2' }
            ];
            const ids = new Set(['1']);
            const result = removeMessagesById(existing, ids);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].id, '2');
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
    });
});