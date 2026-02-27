import { test } from 'node:test';
import assert from 'node:assert';
import { sanitizeThreadTitle } from '../src/features/threads/lib/sanitize-thread-title';

test('sanitizeThreadTitle', async (t) => {
    await t.test('should trim and collapse spaces', () => {
        const input = '   Hello    World   ';
        const expected = 'Hello World';
        assert.strictEqual(sanitizeThreadTitle(input), expected);
    });

    await t.test('should remove control characters', () => {
        const input = 'Hello\u0000World';
        const expected = 'Hello World';
        assert.strictEqual(sanitizeThreadTitle(input), expected);
    });

    await t.test('should remove zero-width characters', () => {
        const input = 'Hello\u200BWorld';
        const expected = 'HelloWorld';
        assert.strictEqual(sanitizeThreadTitle(input), expected);
    });

    await t.test('should remove HTML tag brackets', () => {
        const input = '<Hello> World';
        const expected = 'Hello World';
        assert.strictEqual(sanitizeThreadTitle(input), expected);
    });

    await t.test('should return "New Chat" for empty string', () => {
        const input = '';
        const expected = 'New Chat';
        assert.strictEqual(sanitizeThreadTitle(input), expected);
    });

    await t.test('should return "New Chat" for whitespace-only string', () => {
        const input = '   ';
        const expected = 'New Chat';
        assert.strictEqual(sanitizeThreadTitle(input), expected);
    });

    await t.test('should truncate string to default maxBaseLength (50)', () => {
        const input = 'a'.repeat(60);
        const expected = 'a'.repeat(50) + '...';
        assert.strictEqual(sanitizeThreadTitle(input), expected);
    });

    await t.test('should truncate string to custom maxBaseLength', () => {
        const input = 'a'.repeat(20);
        const maxLen = 10;
        const expected = 'a'.repeat(10) + '...';
        assert.strictEqual(sanitizeThreadTitle(input, maxLen), expected);
    });

    await t.test('should not truncate if length is equal to maxBaseLength', () => {
        const input = 'a'.repeat(50);
        const expected = 'a'.repeat(50);
        assert.strictEqual(sanitizeThreadTitle(input), expected);
    });
});
