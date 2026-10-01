import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { getMarkdownPlugins } from './markdown-plugins';

test('plain text and inline code skip syntax and math transforms', () => {
    const plugins = getMarkdownPlugins('A paragraph with `inline code`.', true);

    assert.equal(plugins.remarkPlugins.length, 1);
    assert.equal(plugins.rehypePlugins.length, 0);
});

test('streaming code defers highlighting until generation completes', () => {
    assert.equal(getMarkdownPlugins('```ts\nconst answer = 42;', true).rehypePlugins.length, 0);
    assert.equal(getMarkdownPlugins('```ts\nconst answer = 42;\n```', true).rehypePlugins.length, 0);
    assert.equal(getMarkdownPlugins('```ts\nconst answer = 42;\n```', false).rehypePlugins.length, 1);
});

test('math transforms activate for complete inline and display equations', () => {
    const inline = getMarkdownPlugins('Area is $a^2$.', true);
    const display = getMarkdownPlugins('$$\nx^2\n$$', true);

    assert.equal(inline.remarkPlugins.length, 2);
    assert.equal(inline.rehypePlugins.length, 1);
    assert.equal(display.remarkPlugins.length, 2);
    assert.equal(display.rehypePlugins.length, 1);
});

test('finished fenced code and math can enable both transforms together', () => {
    const plugins = getMarkdownPlugins('$$x^2$$\n\n```js\nlet x = 1;\n```', false);

    assert.equal(plugins.remarkPlugins.length, 2);
    assert.equal(plugins.rehypePlugins.length, 2);
});

test('finished messages retain highlighting for an unterminated code fence', () => {
    const plugins = getMarkdownPlugins('```js\nlet x = 1;', false);

    assert.equal(plugins.rehypePlugins.length, 1);
});

test('finished nested code fences and unclosed display math retain transforms', () => {
    assert.equal(getMarkdownPlugins('> ```js\n> let x = 1;\n> ```', false).rehypePlugins.length, 1);
    assert.equal(getMarkdownPlugins('$$\nx^2', false).remarkPlugins.length, 2);
});

test('completed documents preserve the previous Markdown output', () => {
    for (const markdown of [
        '**Prose** with `inline code` and [a link](https://example.test).',
        '| a | b |\n| - | - |\n| 1 | 2 |',
        '```js\nconst answer = 42;\n```',
        '> ```js\n> const answer = 42;\n> ```',
        '~~~python\nprint(42)\n~~~',
        '```js\nconst answer = 42;',
        '$$\nx^2',
        'Equation: $x^2 + y^2 = z^2$.',
        'Escaped currency: \\$10 and \\$20.',
        '    const answer = 42;\n',
    ]) {
        const previous = renderToStaticMarkup(createElement(ReactMarkdown, {
            remarkPlugins: [remarkGfm, remarkMath],
            rehypePlugins: [rehypeHighlight, rehypeKatex],
        }, markdown));
        const optimized = renderToStaticMarkup(createElement(ReactMarkdown,
            getMarkdownPlugins(markdown, false), markdown));
        assert.equal(optimized, previous, markdown);
    }
});
