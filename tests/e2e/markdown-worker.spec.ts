import { expect, test, type Locator, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type {} from './fixtures/markdown-worker-harness';

let bundle: string;
let workerBundle: string;

test.beforeAll(async () => {
    const [harness, worker] = await Promise.all([
        build({
            entryPoints: [resolve('tests/e2e/fixtures/markdown-worker-harness.tsx')], bundle: true, write: false,
            format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty' },
            define: {
                'process.env.NODE_ENV': '"development"',
                'process.env': '{}',
                'import.meta.url': '"http://localhost:3000/"',
            },
        }),
        build({
            entryPoints: [resolve('src/features/chat/lib/markdown.worker.ts')], bundle: true, write: false,
            format: 'iife', platform: 'browser', target: 'es2020', conditions: ['worker'], loader: { '.css': 'empty' },
            define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
        }),
    ]);
    bundle = harness.outputFiles[0]!.text;
    workerBundle = worker.outputFiles[0]!.text;
});

async function openMarkdown(page: Page, options: { worker?: 'available' | 'blocked' | 'unavailable' } = {}) {
    const workerMode = options.worker ?? 'available';
    if (workerMode === 'unavailable') {
        await page.addInitScript(() => {
            Object.defineProperty(window, 'Worker', { configurable: true, value: undefined });
        });
    }
    await page.route('**/markdown.worker.ts', route => workerMode === 'blocked'
        ? route.abort()
        : route.fulfill({ contentType: 'text/javascript', body: workerBundle }));
    await page.route('**/__markdown_worker__', route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><div id="root"></div></body></html>',
    }));
    await page.goto('/__markdown_worker__');
    if (workerMode !== 'unavailable') {
        await page.evaluate(() => {
            window.markdownWorkerPosts = [];
            const NativeWorker = window.Worker;
            window.Worker = class extends NativeWorker {
                constructor(scriptURL: string | URL, options?: WorkerOptions) {
                    super(scriptURL, options);
                    const nativePostMessage = this.postMessage.bind(this) as (...args: unknown[]) => void;
                    Object.defineProperty(this, 'postMessage', {
                        configurable: true,
                        value: (...args: unknown[]) => {
                            window.markdownWorkerPosts.push(args[0] as { content: string; isStreaming: boolean });
                            nativePostMessage(...args);
                        },
                    });
                }
            };
        });
    }
    await page.addScriptTag({ content: bundle });
}

async function expectWorkerPost(page: Page, content: string, isStreaming?: boolean) {
    await expect.poll(() => page.evaluate(({ expectedContent, expectedStreaming }) =>
        window.markdownWorkerPosts.some(message => message.content === expectedContent
            && (expectedStreaming === undefined || message.isStreaming === expectedStreaming)),
    { expectedContent: content, expectedStreaming: isStreaming })).toBe(true);
}

async function expectUnsafeContentIsFiltered(page: Page, rendered: Locator) {
    await page.evaluate(() => window.markdownWorkerTest.setContent(
        '[unsafe](javascript:alert(1))\n\n<div data-raw="yes">raw HTML</div>',
    ));
    await expect(rendered).toContainText('unsafe');
    await expect(rendered.locator('a')).not.toHaveAttribute('href', /^javascript:/);
    await expect(rendered.locator('[data-raw]')).toHaveCount(0);
    await expect(rendered).toContainText('raw HTML');
}

test('the bundled worker renders GFM, tables, math, and highlighted code', async ({ page }) => {
    const workerRequest = page.waitForRequest(request => request.url().endsWith('/markdown.worker.ts'));
    await openMarkdown(page);
    await workerRequest;

    await page.evaluate(() => window.markdownWorkerTest.setContent([
        '| Name | Status |',
        '| --- | --- |',
        '| Pluto | ready |',
        '',
        '- [x] GFM task list',
        '',
        'Inline math: $E = mc^2$.',
        '',
        '```js',
        'const answer = 42;',
        '```',
    ].join('\n')));

    const rendered = page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]');
    await expect(rendered.locator('table')).toContainText('Pluto');
    await expect(rendered.locator('input[type="checkbox"]')).toHaveCount(1);
    await expect(rendered.locator('.katex')).toBeVisible();
    await expect(rendered.locator('pre code.language-js')).toContainText('const answer = 42;');
    await expect(rendered.locator('pre code .hljs-keyword')).toHaveCount(1);
});

test('rapid replacements discard stale worker results', async ({ page }) => {
    const workerRequest = page.waitForRequest(request => request.url().endsWith('/markdown.worker.ts'));
    await openMarkdown(page);
    await workerRequest;
    const stale = `# Stale response\n\n${'Stale paragraph content.\n\n'.repeat(10_000)}`;
    await page.evaluate(content => window.markdownWorkerTest.setContent(content), stale);
    await expectWorkerPost(page, stale, false);
    await page.evaluate(() => window.markdownWorkerTest.setContent('# Final response'));
    await expectWorkerPost(page, '# Final response', false);

    const rendered = page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]');
    await expect(rendered).toContainText('Final response');
    await expect(rendered).not.toContainText('Stale response');
});

test('streaming code stays unhighlighted until the same source is completed', async ({ page }) => {
    const workerRequest = page.waitForRequest(request => request.url().endsWith('/markdown.worker.ts'));
    await openMarkdown(page);
    await workerRequest;
    const source = '```js\nconst answer = 42;\n```';

    await page.evaluate(content => {
        window.markdownWorkerTest.setStreaming(true);
        window.markdownWorkerTest.setContent(content);
    }, source);
    await expectWorkerPost(page, source, true);
    const rendered = page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]');
    await expect(rendered.locator('pre code.language-js')).toContainText('const answer = 42;');
    await expect(rendered.locator('pre code .hljs-keyword')).toHaveCount(0);

    await page.evaluate(() => window.markdownWorkerTest.setStreaming(false));
    await expectWorkerPost(page, source, false);
    await expect(rendered.locator('pre code .hljs-keyword')).toHaveCount(1);
});

test('completion parses reference definitions across the full document', async ({ page }) => {
    const workerRequest = page.waitForRequest(request => request.url().endsWith('/markdown.worker.ts'));
    await openMarkdown(page);
    await workerRequest;
    const partial = 'Read the [guide][docs].';
    const finalContent = `${partial}\n\n[docs]: https://example.com/docs "Documentation"`;

    await page.evaluate(content => {
        window.markdownWorkerTest.setStreaming(true);
        window.markdownWorkerTest.setContent(content);
    }, partial);
    await expectWorkerPost(page, partial, true);
    await page.evaluate(content => {
        window.markdownWorkerTest.setContent(content);
    }, finalContent);
    await expectWorkerPost(page, finalContent, true);
    await page.evaluate(() => window.markdownWorkerTest.setStreaming(false));
    await expectWorkerPost(page, finalContent, false);

    const rendered = page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]');
    await expect(rendered.getByRole('link', { name: 'guide' })).toHaveAttribute('href', 'https://example.com/docs');
    await expect(rendered).not.toContainText('[docs]:');
});

test('unmounting a queued parse cannot publish stale content after remount', async ({ page }) => {
    const workerRequest = page.waitForRequest(request => request.url().endsWith('/markdown.worker.ts'));
    await openMarkdown(page);
    await workerRequest;
    const stale = `# Unmounted response\n\n${'Stale queued paragraph.\n\n'.repeat(10_000)}`;
    await page.evaluate(content => window.markdownWorkerTest.setContent(content), stale);
    await expectWorkerPost(page, stale, false);

    await page.evaluate(() => window.markdownWorkerTest.setVisible(false));
    await expect(page.locator('[data-markdown-state]')).toHaveCount(0);
    await page.evaluate(() => {
        window.markdownWorkerTest.setContent('# Remounted response');
        window.markdownWorkerTest.setVisible(true);
    });
    await expectWorkerPost(page, '# Remounted response', false);

    const rendered = page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]');
    await expect(rendered).toContainText('Remounted response');
    await expect(rendered).not.toContainText('Unmounted response');
});

test('completed documents reuse exact-source trees across virtualized remounts', async ({ page }) => {
    const workerRequest = page.waitForRequest(request => request.url().endsWith('/markdown.worker.ts'));
    await openMarkdown(page);
    await workerRequest;
    const rendered = page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]');
    await expect(rendered).toContainText('Initial worker content');
    const initialPostCount = await page.evaluate(() => window.markdownWorkerPosts.length);

    await page.evaluate(() => window.markdownWorkerTest.setVisible(false));
    await expect(page.locator('[data-markdown-state]')).toHaveCount(0);
    await page.evaluate(() => window.markdownWorkerTest.setVisible(true));
    await expect(page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]')).toContainText('Initial worker content');
    await expect.poll(() => page.evaluate(() => window.markdownWorkerPosts.length)).toBe(initialPostCount);

    await page.evaluate(() => window.markdownWorkerTest.setContent('Initial worker content!'));
    await expectWorkerPost(page, 'Initial worker content!', false);
    await expect(page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]')).toContainText('Initial worker content!');
});

test('account cache-clear events invalidate completed trees while markdown is unmounted', async ({ page }) => {
    const workerRequest = page.waitForRequest(request => request.url().endsWith('/markdown.worker.ts'));
    await openMarkdown(page);
    await workerRequest;
    const source = 'Private account markdown';
    await page.evaluate(markdown => window.markdownWorkerTest.setContent(markdown), source);
    const rendered = page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]');
    await expect(rendered).toContainText(source);
    const initialPostCount = await page.evaluate(() => window.markdownWorkerPosts.filter(message => message.content === 'Private account markdown').length);

    await page.evaluate(() => window.markdownWorkerTest.setVisible(false));
    await expect(page.locator('[data-markdown-state]')).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('pluto:clear-markdown-cache')));
    await page.evaluate(() => window.markdownWorkerTest.setVisible(true));

    await expectWorkerPost(page, source, false);
    await expect.poll(() => page.evaluate(() => window.markdownWorkerPosts.filter(message => message.content === 'Private account markdown').length)).toBe(initialPostCount + 1);
    await expect(page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]')).toContainText(source);
});

test('mutating a custom component node cannot poison the cached tree', async ({ page }) => {
    const workerRequest = page.waitForRequest(request => request.url().endsWith('/markdown.worker.ts'));
    await openMarkdown(page);
    await workerRequest;
    const source = '# Cached title';

    await page.evaluate(markdown => {
        window.markdownWorkerTest.setMutateNodes(true);
        window.markdownWorkerTest.setContent(markdown);
    }, source);
    const rendered = page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]');
    await expect(rendered.locator('h1')).toHaveText('Cached title');
    const postCount = await page.evaluate(() => window.markdownWorkerPosts.length);

    await page.evaluate(() => {
        window.markdownWorkerTest.setVisible(false);
        window.markdownWorkerTest.setMutateNodes(false);
    });
    await expect(page.locator('[data-markdown-state]')).toHaveCount(0);
    await page.evaluate(() => window.markdownWorkerTest.setVisible(true));

    const remounted = page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]');
    await expect(remounted.locator('h1')).toHaveText('Cached title');
    await expect.poll(() => page.evaluate(() => window.markdownWorkerPosts.length)).toBe(postCount);
});

test('streaming trees are not reused from the finalized document cache', async ({ page }) => {
    const workerRequest = page.waitForRequest(request => request.url().endsWith('/markdown.worker.ts'));
    await openMarkdown(page);
    await workerRequest;
    const source = 'A reply that is still streaming';
    await page.evaluate(content => {
        window.markdownWorkerTest.setStreaming(true);
        window.markdownWorkerTest.setContent(content);
    }, source);
    await expectWorkerPost(page, source, true);
    await expect(page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]')).toContainText(source);
    const previousPostCount = await page.evaluate(() => window.markdownWorkerPosts.filter(message => message.content === 'A reply that is still streaming').length);

    await page.evaluate(() => window.markdownWorkerTest.setVisible(false));
    await expect(page.locator('[data-markdown-state]')).toHaveCount(0);
    await page.evaluate(() => window.markdownWorkerTest.setVisible(true));
    await expect.poll(() => page.evaluate(() => window.markdownWorkerPosts.filter(message => message.content === 'A reply that is still streaming').length)).toBe(previousPostCount + 1);
    await expect(page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]')).toContainText(source);
});

test('the worker preserves unsafe-link and raw-HTML filtering', async ({ page }) => {
    const workerRequest = page.waitForRequest(request => request.url().endsWith('/markdown.worker.ts'));
    await openMarkdown(page);
    await workerRequest;
    await expectUnsafeContentIsFiltered(page, page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]'));
});

test('a blocked worker falls back to the main-thread renderer with the same safety rules', async ({ page }) => {
    await openMarkdown(page, { worker: 'blocked' });
    const fallback = page.locator('[data-markdown-engine="main"][data-markdown-state="ready"]');
    await expect(fallback).toBeVisible();
    await expectUnsafeContentIsFiltered(page, fallback);
});

test('an unavailable Worker API uses the main-thread renderer', async ({ page }) => {
    await openMarkdown(page, { worker: 'unavailable' });
    const fallback = page.locator('[data-markdown-engine="main"][data-markdown-state="ready"]');
    await expect(fallback).toContainText('Initial worker content');
    await page.evaluate(() => window.markdownWorkerTest.setContent('Fallback **parsed** text'));
    await expect(fallback.locator('strong')).toHaveText('parsed');
});

test('custom code-block components retain exact clipboard copy behavior', async ({ page }) => {
    const workerRequest = page.waitForRequest(request => request.url().endsWith('/markdown.worker.ts'));
    await openMarkdown(page);
    await workerRequest;
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async (value: string) => { sessionStorage.setItem('copied-code', value); },
        } });
        window.markdownWorkerTest.setContent('```\n#define VERSION 2\nconst regex = /\\[abc\\]/;\n```');
    });
    const rendered = page.locator('[data-markdown-engine="worker"][data-markdown-state="ready"]');
    const code = '#define VERSION 2\nconst regex = /\\[abc\\]/;\n';
    await expect(rendered.locator('pre code')).toHaveText(code);
    await rendered.getByRole('button', { name: 'Copy code', exact: true }).click();
    await expect(rendered.getByRole('button', { name: 'Code copied', exact: true })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('copied-code'))).toBe(code);
});
