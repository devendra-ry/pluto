import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Root } from 'hast';

import { MarkdownTreeCache } from './markdown-tree-cache';

function tree(value: string): Root {
    return { type: 'root', children: [{ type: 'text', value }] };
}

test('the Markdown tree cache evicts least-recently-used entries at its count bound', () => {
    const cache = new MarkdownTreeCache(2, 10_000, 10_000);
    cache.set('first', { tree: tree('one'), engine: 'worker' });
    cache.set('second', { tree: tree('two'), engine: 'main' });
    cache.touch('first');
    cache.set('third', { tree: tree('three'), engine: 'worker' });

    assert.equal(cache.size, 2);
    assert.ok(cache.getSnapshot('first'));
    assert.equal(cache.getSnapshot('second'), null);
    assert.equal(cache.getSnapshot('third')?.engine, 'worker');
});

test('the Markdown tree cache enforces its serialized-tree byte budget', () => {
    const firstTree = tree('a'.repeat(20));
    const secondTree = tree('b'.repeat(24));
    const firstBytes = JSON.stringify({ source: 'first', tree: firstTree })!.length * 2;
    const secondBytes = JSON.stringify({ source: 'second', tree: secondTree })!.length * 2;
    const cache = new MarkdownTreeCache(10, firstBytes + secondBytes - 1, firstBytes + secondBytes);

    assert.equal(cache.set('first', { tree: firstTree, engine: 'worker' }), true);
    assert.equal(cache.set('second', { tree: secondTree, engine: 'main' }), true);
    assert.equal(cache.getSnapshot('first'), null);
    assert.ok(cache.getSnapshot('second'));
    assert.ok(cache.byteSize <= cache.maxBytes);
});

test('oversized trees are skipped and account changes clear retained entries', () => {
    const cache = new MarkdownTreeCache(5, 10_000, 300);
    let notified = 0;
    const unsubscribe = cache.subscribe('private text', () => { notified += 1; });

    assert.equal(cache.set('private text', { tree: tree('x'.repeat(200)), engine: 'worker' }), false);
    assert.equal(cache.size, 0);
    assert.equal(cache.set('private text', { tree: tree('safe'), engine: 'worker' }), true);
    assert.ok(cache.getSnapshot('private text'));
    cache.clear();
    assert.equal(cache.getSnapshot('private text'), null);
    assert.equal(notified, 2);
    unsubscribe();
});

test('snapshot references stay stable until the entry changes', () => {
    const cache = new MarkdownTreeCache();
    cache.set('source', { tree: tree('one'), engine: 'worker' });
    const firstSnapshot = cache.getSnapshot('source');
    assert.strictEqual(firstSnapshot, cache.getSnapshot('source'));
    cache.set('source', { tree: tree('two'), engine: 'worker' });
    const secondSnapshot = cache.getSnapshot('source');
    assert.notStrictEqual(secondSnapshot, firstSnapshot);
    assert.equal(secondSnapshot?.tree.children[0]?.type === 'text' ? secondSnapshot.tree.children[0].value : null, 'two');
});
