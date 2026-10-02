import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { visit } from 'unist-util-visit';
import { parseMarkdown } from './markdown-parser';
import { getMarkdownPlugins } from './markdown-plugins';
import { preprocessMarkdownSource } from './markdown-source';

const samples = [
    'Unicode 👩🏽‍💻 café and **bold** with _emphasis_.',
    '| Name | Value |\n| --- | --- |\n| a | ~~old~~ |\n\n- [x] Done\n- [ ] Next',
    '> quote\n>\n> - nested item\n\n[reference][ref]\n\n[ref]: https://example.test',
    '```ts\n#define VERSION 2\nconst regex = /\\[abc\\]/;\n```',
    '\\[x^2 + y^2 = z^2\\]\n\nInline \\(a+b\\) and $z$.',
    '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[js](javascript:alert%281%29)',
    '[relative](/a:b) [mail](mailto:a@example.test) [secure](https://example.test) [bad](vbscript:evil)',
    '```js\nconst incomplete = "hello',
    '    \\[literal\\]\n\n`\\(literal\\)`',
];

test('worker trees preserve ReactMarkdown output and survive structured cloning', () => {
    for (const content of samples) {
        for (const isStreaming of [true, false]) {
            const markdown = preprocessMarkdownSource(content);
            const expected = renderToStaticMarkup(createElement(ReactMarkdown, getMarkdownPlugins(markdown, isStreaming), markdown));
            const tree = structuredClone(parseMarkdown(content, isStreaming));
            const actual = renderToStaticMarkup(toJsxRuntime(tree, {
                Fragment, jsx, jsxs, ignoreInvalidStyle: true, passKeys: true, passNode: true,
            }));
            assert.equal(actual, expected, `${isStreaming ? 'streaming' : 'complete'}: ${content}`);
        }
    }
});

test('worker syntax trees remove executable and data image URL schemes', () => {
    const tree = parseMarkdown('![script](javascript:evil) ![data](data:text/html,evil) ![safe](https://example.test/image.png)', false);
    const sources: unknown[] = [];
    visit(tree, 'element', node => { if (node.tagName === 'img') sources.push(node.properties.src); });
    assert.deepEqual(sources, ['', '', 'https://example.test/image.png']);
});

test('custom code components receive the same source after worker serialization', () => {
    const tree = structuredClone(parseMarkdown('```js\nconst value = "🧠";\n```', false));
    let received = '';
    renderToStaticMarkup(toJsxRuntime(tree, {
        Fragment, jsx, jsxs, passNode: true,
        components: { pre: ({ node }) => {
            const collect = (node: { value?: string; children?: unknown[] }): string => node.value ?? (node.children ?? []).map(child => collect(child as typeof node)).join('');
            received = collect(node!);
            return createElement('div', null, received);
        } },
    }));
    assert.equal(received, 'const value = "🧠";\n');
});
