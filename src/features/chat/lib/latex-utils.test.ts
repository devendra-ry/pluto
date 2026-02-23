import { test } from 'node:test';
import assert from 'node:assert';
import { preprocessLaTeX } from './latex-utils';

test('preprocessLaTeX', async (t) => {
    await t.test('should return empty string if text is empty', () => {
        assert.strictEqual(preprocessLaTeX(''), '');
    });

    await t.test('should return original text if no latex found', () => {
        const text = 'Hello world';
        assert.strictEqual(preprocessLaTeX(text), text);
    });

    await t.test('should replace block math with $$', () => {
        const input = 'Here is a formula: \\[ E = mc^2 \\]';
        const expected = 'Here is a formula: \n$$\n E = mc^2 \n$$\n';
        assert.strictEqual(preprocessLaTeX(input), expected);
    });

    await t.test('should replace inline math with $', () => {
        const input = 'This is inline \\( a^2 + b^2 = c^2 \\)';
        const expected = 'This is inline $ a^2 + b^2 = c^2 $';
        assert.strictEqual(preprocessLaTeX(input), expected);
    });

    await t.test('should handle mixed math', () => {
        const input = 'Inline \\( x \\) and block \\[ y \\]';
        const expected = 'Inline $ x $ and block \n$$\n y \n$$\n';
        assert.strictEqual(preprocessLaTeX(input), expected);
    });
});
