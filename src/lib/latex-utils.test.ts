import { test } from 'node:test';
import assert from 'node:assert';
import { preprocessLaTeX } from './latex-utils';

test('preprocessLaTeX', async (t) => {
    await t.test('returns original text if empty', () => {
        assert.strictEqual(preprocessLaTeX(''), '');
        // @ts-expect-error Testing runtime behavior for null/undefined if passed unsafely
        assert.strictEqual(preprocessLaTeX(null), null);
        // @ts-expect-error Testing runtime behavior for null/undefined if passed unsafely
        assert.strictEqual(preprocessLaTeX(undefined), undefined);
    });

    await t.test('replaces block math \\[ ... \\]', () => {
        const input = 'Here is an equation: \\[ E = mc^2 \\]';
        const expected = 'Here is an equation: \n$$\n E = mc^2 \n$$\n';
        assert.strictEqual(preprocessLaTeX(input), expected);
    });

    await t.test('replaces block math with double backslashes \\\\[ ... \\\\]', () => {
        const input = 'Here is an equation: \\\\[ E = mc^2 \\\\]';
        const expected = 'Here is an equation: \n$$\n E = mc^2 \n$$\n';
        assert.strictEqual(preprocessLaTeX(input), expected);
    });

    await t.test('replaces inline math \\( ... \\)', () => {
        const input = 'Here is inline: \\( a^2 + b^2 = c^2 \\)';
        const expected = 'Here is inline: $ a^2 + b^2 = c^2 $';
        assert.strictEqual(preprocessLaTeX(input), expected);
    });

    await t.test('replaces inline math with double backslashes \\\\( ... \\\\)', () => {
        const input = 'Here is inline: \\\\( a^2 + b^2 = c^2 \\\\)';
        const expected = 'Here is inline: $ a^2 + b^2 = c^2 $';
        assert.strictEqual(preprocessLaTeX(input), expected);
    });

    await t.test('handles mixed content', () => {
        const input = 'Inline \\( x \\) and block \\[ y \\]';
        const expected = 'Inline $ x $ and block \n$$\n y \n$$\n';
        assert.strictEqual(preprocessLaTeX(input), expected);
    });

    await t.test('handles multiline block math', () => {
        const input = '\\[\n\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}\n\\]';
        const expected = '\n$$\n\n\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}\n\n$$\n';
        assert.strictEqual(preprocessLaTeX(input), expected);
    });
});
