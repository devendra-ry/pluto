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

test('streaming code defers highlighting until generation completes', () => {
    assert.equal(getMarkdownPlugins('```ts\nconst answer = 42;', true).rehypePlugins.length, 0);
    assert.equal(getMarkdownPlugins('```ts\nconst answer = 42;\n```', true).rehypePlugins.length, 0);
    assert.equal(getMarkdownPlugins('```ts\nconst answer = 42;\n```', false).rehypePlugins.length, 1);
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
