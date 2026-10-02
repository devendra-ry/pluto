import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';

import { preprocessMarkdownSource } from './markdown-source';

function renderedCode(source: string): string[] {
    const markup = renderToStaticMarkup(createElement(ReactMarkdown, null, source));
    return markup.match(/<code(?:\s[^>]*)?>[\s\S]*?<\/code>/g) ?? [];
}

test('converts supported LaTeX delimiters in prose', () => {
    assert.equal(
        preprocessMarkdownSource('Inline \\(x + 1\\) and display \\[y^2\\].'),
        'Inline $x + 1$ and display \n$$\ny^2\n$$\n.',
    );
});

test('preserves fenced and incomplete fenced code exactly as Markdown renders it', () => {
    const sources = [
        '```c\n#define SCALE(x) ((x) * 2)\nconst value = "\\(literal\\)";\n```\n',
        '~~~js\nconst value = "\\[literal\\]";\n',
        '> ```c\n> #define SCALE(x) ((x) * 2)\n> const value = "\\(literal\\)";\n> ```\n',
        '- ```c\n  #define SCALE(x) ((x) * 2)\n  const value = "\\(literal\\)";\n  ```\n',
    ];

    for (const source of sources) {
        assert.deepEqual(renderedCode(preprocessMarkdownSource(source)), renderedCode(source), source);
    }
});

test('preserves indented and inline code while transforming surrounding prose', () => {
    const source = [
        'Inline `\\(x + 1\\)` remains code while \\(y + 1\\) becomes math.',
        '',
        '    #define SCALE(x) ((x) * 2) \\(code\\)',
        '',
        'After the code, \\[z^2\\] is still transformed.',
    ].join('\n');
    const processed = preprocessMarkdownSource(source);

    assert.deepEqual(renderedCode(processed), renderedCode(source));
    assert.match(processed, /while \$y \+ 1\$ becomes math/);
    assert.match(processed, /\$\$\nz\^2\n\$\$/);
    assert.ok(processed.includes('    #define SCALE(x) ((x) * 2) \\(code\\)'));
});

test('leaves heading-like source such as preprocessor directives unchanged', () => {
    const source = '#define SIZE 4\n###Title\n';
    assert.equal(preprocessMarkdownSource(source), source);
});
