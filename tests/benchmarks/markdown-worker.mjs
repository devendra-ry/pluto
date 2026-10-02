import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

// Browser benchmark: identical parsing, with and without the production worker
// queue. Includes worker startup/transfer in round-trip time; separates UI stalls.
const [main, workerBundle] = await Promise.all([
    build({ stdin: {
        contents: `import { parseMarkdown } from './src/features/chat/lib/markdown-parser';
            import { markdownWorker } from './src/features/chat/lib/markdown-worker-client';
            import { WorkerMarkdown } from './src/features/chat/components/worker-markdown';
            import { createElement } from 'react';
            import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
            import { createRoot } from 'react-dom/client';
            import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
            const root = createRoot(document.getElementById('root'));
            function Baseline({content}) {
                return createElement('div', {'data-markdown-state': 'ready'}, toJsxRuntime(parseMarkdown(content, false),
                    {Fragment, jsx, jsxs, ignoreInvalidStyle: true, passKeys: true, passNode: true}));
            }
            window.markdownBench = { parseMarkdown, markdownWorker,
                render: (content, engine) => root.render(createElement(engine === 'main' ? Baseline : WorkerMarkdown, {content, isStreaming: false})) };`,
        resolveDir: resolve('.'), sourcefile: 'markdown-benchmark.ts', loader: 'ts',
    }, bundle: true, write: false, format: 'iife', platform: 'browser',
        define: { 'import.meta.url': '"http://markdown-benchmark.test/"', 'process.env.NODE_ENV': '"production"' } }),
    build({ entryPoints: [resolve('src/features/chat/lib/markdown.worker.ts')],
        bundle: true, write: false, format: 'iife', platform: 'browser',
        conditions: ['worker'],
        define: { 'process.env.NODE_ENV': '"production"' } }),
]);
const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    await page.context().route('http://markdown-benchmark.test/**', route => route.fulfill({
        contentType: route.request().url().endsWith('/markdown.worker.ts') ? 'text/javascript' : 'text/html',
        body: route.request().url().endsWith('/markdown.worker.ts') ? workerBundle.outputFiles[0].text
            : '<!doctype html><html><body><div id="root"></div></body></html>',
    }));
    await page.goto('http://markdown-benchmark.test/');
    await page.addScriptTag({ content: main.outputFiles[0].text });
    const measurements = await page.evaluate(async () => {
        const block = '# Example\n\nA paragraph with **bold**, _emphasis_, and a [link](https://example.test).\n\n'
            + '| Name | Value |\n| --- | --- |\n| a | 42 |\n\n'
            + '$$x^2 + y^2 = z^2$$\n\n```typescript\nconst value = { name: "hello", count: 42 };\nconsole.log(value);\n```\n\n';
        const content = block.repeat(120);
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        async function measure(engine, operation = () => engine === 'main'
                ? window.markdownBench.parseMarkdown(content, false)
                : window.markdownBench.markdownWorker.parse(content, false, new AbortController().signal)) {
            let previous = 0;
            let largestGap = 0;
            let frames = 0;
            let tracking = true;
            const tick = () => {
                const now = performance.now();
                if (previous) largestGap = Math.max(largestGap, now - previous);
                previous = now;
                frames++;
                if (tracking) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            await frame(); await frame();
            const start = performance.now();
            const result = await operation();
            const elapsedMs = performance.now() - start;
            // Include the next frame: synchronous work blocks it until parsing ends.
            await frame(); await pause(25);
            tracking = false;
            return { elapsedMs, largestFrameGapMs: largestGap, frames, nodes: result?.children?.length };
        }
        // Measure cold worker startup, then alternate warm runs to reduce bias.
        const coldWorker = await measure('worker');
        window.markdownBench.parseMarkdown(content, false);
        const main = [], worker = [];
        for (let round = 0; round < 5; round++) {
            if (round % 2) { worker.push(await measure('worker')); main.push(await measure('main')); }
            else { main.push(await measure('main')); worker.push(await measure('worker')); }
        }
        let revision = 0;
        async function render(engine) {
            const marker = `Benchmark revision ${++revision}`;
            return new Promise(resolve => {
                const observer = new MutationObserver(() => {
                    const rendered = document.querySelector('[data-markdown-state="ready"]');
                    if (rendered?.textContent.includes(marker)) { observer.disconnect(); resolve(); }
                });
                observer.observe(document.getElementById('root'), { subtree: true, childList: true, attributes: true, characterData: true });
                window.markdownBench.render(content + '\n\n' + marker, engine);
            });
        }
        const ui = { main: [], worker: [] };
        for (const engine of ['main', 'worker']) {
            await render(engine); // warm the DOM and renderer before updating
            for (let round = 0; round < 5; round++) ui[engine].push(await measure(engine, () => render(engine)));
        }
        window.markdownBench.markdownWorker.dispose();
        return { sourceChars: content.length, coldWorker, main, worker, ui };
    });
    const median = (runs, key) => [...runs].map(run => run[key]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
    const summary = engine => ({
        medianRoundTripMs: Number(median(measurements[engine], 'elapsedMs').toFixed(1)),
        medianLargestFrameGapMs: Number(median(measurements[engine], 'largestFrameGapMs').toFixed(1)),
    });
    const baseline = summary('main');
    const offloaded = summary('worker');
    console.log(JSON.stringify({ scenario: '120 repeated code/math/table blocks; parsing only',
        sourceChars: measurements.sourceChars, rounds: 5, baseline, offloaded,
        frameGapReductionPercent: Number((100 * (1 - offloaded.medianLargestFrameGapMs / baseline.medianLargestFrameGapMs)).toFixed(1)),
        coldWorkerRoundTripMs: Number(measurements.coldWorker.elapsedMs.toFixed(1)),
        note: 'Synthetic headless Chromium. DOM rendering is not included; worker speed is not AI latency.',
    }, null, 2));
    const uiSummary = engine => ({
        medianRoundTripMs: Number(median(measurements.ui[engine], 'elapsedMs').toFixed(1)),
        medianLargestFrameGapMs: Number(median(measurements.ui[engine], 'largestFrameGapMs').toFixed(1)),
    });
    const uiMain = uiSummary('main'), uiWorker = uiSummary('worker');
    console.log(JSON.stringify({ scenario: 'same document, React/DOM updates included', baseline: uiMain, offloaded: uiWorker,
        frameGapReductionPercent: Number((100 * (1 - uiWorker.medianLargestFrameGapMs / uiMain.medianLargestFrameGapMs)).toFixed(1)),
        note: 'Synthetic headless Chromium; excludes app layout/styles, AI/network time.',
    }, null, 2));
} finally { await browser.close(); }
