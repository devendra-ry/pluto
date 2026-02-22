import { test } from 'node:test';
import assert from 'node:assert';
import { getOption } from './utils';

test('getOption', async (t) => {
    await t.test('returns the matching option', () => {
        const options = [{ id: 1 }, { id: 2 }, { id: 3 }];
        const result = getOption(options, (item) => item.id === 2);
        assert.deepStrictEqual(result, { id: 2 });
    });

    await t.test('returns the first option if no match found', () => {
        const options = [{ id: 1 }, { id: 2 }, { id: 3 }];
        const result = getOption(options, (item) => item.id === 4);
        assert.deepStrictEqual(result, { id: 1 });
    });

    await t.test('returns the first option if options array is not empty', () => {
        const options = ['a', 'b'];
        const result = getOption(options, (item) => item === 'c');
        assert.strictEqual(result, 'a');
    });

    await t.test('returns undefined if options array is empty', () => {
        const options: string[] = [];
        const result = getOption(options, (item) => item === 'c');
        assert.strictEqual(result, undefined);
    });
});
