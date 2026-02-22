import { test } from 'node:test';
import assert from 'node:assert';
import { cn } from '../src/lib/utils';

test('cn utility', async (t) => {
    await t.test('should merge class names correctly', () => {
        const result = cn('c1', 'c2');
        assert.strictEqual(result, 'c1 c2');
    });

    await t.test('should handle conditional class names (clsx behavior)', () => {
        const result = cn('c1', false && 'c2', 'c3', null, undefined);
        assert.strictEqual(result, 'c1 c3');
    });

    await t.test('should merge conflicting tailwind classes correctly', () => {
        const result = cn('p-4', 'p-2');
        assert.strictEqual(result, 'p-2');
    });

    await t.test('should handle arrays of class names', () => {
        const result = cn(['c1', 'c2'], 'c3');
        assert.strictEqual(result, 'c1 c2 c3');
    });

    await t.test('should handle objects of class names', () => {
        const result = cn({ c1: true, c2: false, c3: true });
        assert.strictEqual(result, 'c1 c3');
    });

    await t.test('should handle complex combinations', () => {
        const result = cn('base', { active: true, disabled: false }, ['extra', null], 'p-4', 'p-2');
        assert.strictEqual(result, 'base active extra p-2');
    });

    await t.test('should return empty string for no input', () => {
        const result = cn();
        assert.strictEqual(result, '');
    });

    await t.test('should return empty string for empty inputs', () => {
        const result = cn('', null, undefined, false);
        assert.strictEqual(result, '');
    });
});
