import { performance } from 'node:perf_hooks';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { getMarkdownPlugins } from '../../src/features/chat/lib/markdown-plugins';
import { isPlainMarkdownParagraph, takeFinalizedParagraphs } from '../../src/features/chat/lib/streaming-markdown-segments';

const BASELINE_REMARK_PLUGINS = [remarkGfm, remarkMath];
const BASELINE_REHYPE_PLUGINS = [rehypeHighlight, rehypeKatex];
const BLOCK = 'This response paragraph has **formatting**, a [link](https://example.test), and enough text to resemble an assistant reply.\n\n';
const STREAM_STEPS = 32;
const ROUNDS = 3;

function snapshots(includeRichMarkdown: boolean) {
    const values: string[] = [];
    let content = '';

    for (let index = 0; index < STREAM_STEPS; index += 1) {
        content += BLOCK;
        if (includeRichMarkdown && index === STREAM_STEPS - 4) {
            content += 'Equation: $x^2 + y^2 = z^2$.\n\n```ts\nconst answer = 42;\n```\n\n';
        }
        values.push(content);
    }

    return values;
}

function render(markdown: string, optimized: boolean) {
    const plugins = optimized
        ? getMarkdownPlugins(markdown, true)
        : { remarkPlugins: BASELINE_REMARK_PLUGINS, rehypePlugins: BASELINE_REHYPE_PLUGINS };

    renderToStaticMarkup(createElement(ReactMarkdown, plugins, markdown));
}

function renderPlainParagraph(text: string) {
    renderToStaticMarkup(createElement('p', null, text));
}

function measure(values: string[], optimized: boolean) {
    const startedAt = performance.now();
    for (const value of values) render(value, optimized);
    return performance.now() - startedAt;
}

function measureSegmented(values: string[]) {
    const startedAt = performance.now();
    let processedLength = 0;

    for (const latest of values) {
        const finalized = takeFinalizedParagraphs(latest.slice(processedLength));
        if (finalized.consumed > 0) {
            processedLength += finalized.consumed;
            if (finalized.blocks.length > 0) {
                const segment = finalized.blocks.join('\n\n');
                render(segment, false);
            }
        }

        const tail = latest.slice(processedLength);
        if (tail) {
            if (isPlainMarkdownParagraph(tail)) renderPlainParagraph(tail);
            else render(tail, true);
        }
    }

    // The component intentionally renders the exact complete source once when
    // streaming ends so Markdown constructs can resolve across segments.
    const complete = values.at(-1);
    if (complete) render(complete, false);
    return performance.now() - startedAt;
}

function median(values: number[]) {
    return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0;
}

for (const [name, values] of [
    ['plain prose', snapshots(false)],
    ['prose with code and math', snapshots(true)],
] as const) {
    // Warm both paths before measuring to reduce one-time JIT and module costs.
    measure(values.slice(0, 2), false);
    measure(values.slice(0, 2), true);

    const baseline = median(Array.from({ length: ROUNDS }, () => measure(values, false)));
    const gated = median(Array.from({ length: ROUNDS }, () => measure(values, true)));
    const segmented = median(Array.from({ length: ROUNDS }, () => measureSegmented(values)));
    console.log(`${name}: always-on ${baseline.toFixed(1)}ms, gated ${gated.toFixed(1)}ms, segmented + final ${segmented.toFixed(1)}ms, ${(baseline / segmented).toFixed(2)}x faster`);
}
