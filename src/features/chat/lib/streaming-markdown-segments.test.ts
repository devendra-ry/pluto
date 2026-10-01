import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';

import { getMarkdownPlugins } from './markdown-plugins';
import { isPlainMarkdownParagraph, takeFinalizedParagraphs } from './streaming-markdown-segments';

test('recognizes only plain one-line text for the streaming fast path', () => {
    for (const source of ['The answer is 42.', 'Numbers: 1, 2, and 3', 'It’s ready!', 'सारांश यहाँ है', 'cafe\u0301']) {
        assert.equal(isPlainMarkdownParagraph(source), true, source);
    }

    for (const source of [
        '**bold** text',
        'underscore_syntax',
        '[reference]',
        'www.example.test',
        'bitcoin:address',
        'https://example.test/path',
        'user@example.test',
        '&amp;',
        'line one\nline two',
        '    indented code',
        '- list item',
        '1. ordered list',
        '2) ordered list',
    ]) {
        assert.equal(isPlainMarkdownParagraph(source), false, source);
    }
});

test('freezes only standalone prose and preserves the live tail', () => {
    const source = 'First **paragraph**.\n\nSecond paragraph.\n\nStill arriving';
    const result = takeFinalizedParagraphs(source);

    assert.deepEqual(result.blocks, ['First **paragraph**.', 'Second paragraph.']);
    assert.equal(source.slice(result.consumed), 'Still arriving');
});

test('separately rendered safe paragraphs have the same HTML as the full prefix', () => {
    const source = 'First **paragraph**.\n\nSecond paragraph with _emphasis_.\n\nLive tail';
    const { blocks, consumed } = takeFinalizedParagraphs(source);
    const parts = [...blocks, source.slice(consumed)].filter(Boolean);
    const streamedHtml = parts.map((part) => renderToStaticMarkup(createElement(
        ReactMarkdown,
        getMarkdownPlugins(part, true),
        part,
    ))).join('');
    const fullHtml = renderToStaticMarkup(createElement(
        ReactMarkdown,
        getMarkdownPlugins(source, true),
        source,
    ));

    // Separate ReactMarkdown roots omit the formatter's inter-block newline
    // text nodes; those whitespace nodes do not change rendered Markdown.
    assert.equal(streamedHtml.replace(/>\s+</g, '><'), fullHtml.replace(/>\s+</g, '><'));
});

test('keeps syntax with cross-block meaning in the live tail', () => {
    const unsafeBlocks = [
        '[answer]',
        '[answer]: https://example.test',
        'Open `code span',
        'Equation $x^2',
        '```ts\nconst answer = 42;\n```',
        '- list item',
        '> quoted text',
        '<span>raw HTML</span>',
        '    indented code',
        '\tindented code',
    ];

    for (const block of unsafeBlocks) {
        const source = `${block}\n\nNext paragraph`;
        const result = takeFinalizedParagraphs(source);
        assert.deepEqual(result, { blocks: [], consumed: 0 }, block);
    }
});

test('does not freeze prose preceding an unsafe block after that boundary', () => {
    const source = 'Safe prose.\n\n[unresolved reference]\n\nLater text';
    const result = takeFinalizedParagraphs(source);

    assert.deepEqual(result.blocks, ['Safe prose.']);
    assert.equal(source.slice(result.consumed), '[unresolved reference]\n\nLater text');
});
