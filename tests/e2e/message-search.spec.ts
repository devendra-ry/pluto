import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type {} from './fixtures/message-search-history-harness';
import type {} from './fixtures/message-search-history-mock';

let bundle: string;

test.beforeAll(async () => {
    const result = await build({
        entryPoints: [resolve('tests/e2e/fixtures/message-search-history-harness.tsx')],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
        plugins: [{
            name: 'message-search-browser-stubs',
            setup(builder) {
                builder.onResolve({ filter: /^@\/shared\/lib\/supabase\/client$/ }, () => ({ path: resolve('tests/e2e/fixtures/message-search-history-mock.ts') }));
                builder.onResolve({ filter: /^@\/shared\/lib\/query-client$/ }, () => ({ path: resolve('tests/e2e/fixtures/message-search-history-mock.ts') }));
                builder.onResolve({ filter: /^@\/shared\/core\/constants$/ }, () => ({ path: 'constants', namespace: 'search-stub' }));
                builder.onResolve({ filter: /^@\/shared\/core\/utils$/ }, () => ({ path: 'utils', namespace: 'search-stub' }));
                builder.onResolve({ filter: /^@\/components\/ui\/button$/ }, () => ({ path: 'button', namespace: 'search-stub' }));
                builder.onResolve({ filter: /^@\/components\/ui\/input$/ }, () => ({ path: 'input', namespace: 'search-stub' }));
                builder.onResolve({ filter: /^@\/components\/ui\/dialog$/ }, () => ({ path: 'dialog', namespace: 'search-stub' }));
                builder.onResolve({ filter: /^\.\/chat-message$/ }, () => ({ path: 'chat-message', namespace: 'search-stub' }));
                builder.onLoad({ filter: /.*/, namespace: 'search-stub' }, args => {
                    const resolveDir = resolve('tests/e2e/fixtures');
                    if (args.path === 'constants') return { loader: 'js', resolveDir, contents: `export const AVAILABLE_MODELS = [];` };
                    if (args.path === 'utils') return { loader: 'js', resolveDir, contents: `export function cn(...values) { return values.filter(Boolean).join(' '); }` };
                    if (args.path === 'button') return { loader: 'tsx', resolveDir, contents: `export function Button({ variant, size, ...props }) { return <button {...props} />; }` };
                    if (args.path === 'input') return { loader: 'tsx', resolveDir, contents: `export function Input(props) { return <input {...props} />; }` };
                    if (args.path === 'dialog') return {
                        loader: 'tsx', resolveDir,
                        contents: `export function Dialog({ open, onOpenChange, children }) { return open ? <div>{children}<button type="button" aria-label="Close search" onClick={() => onOpenChange(false)}>Close</button></div> : null; }
                            export function DialogContent({ children, ...props }) { return <section role="dialog" aria-modal="true" {...props}>{children}</section>; }
                            export function DialogDescription(props) { return <p {...props} />; }
                            export function DialogTitle(props) { return <h2 {...props} />; }`,
                    };
                    return {
                        loader: 'tsx', resolveDir,
                        contents: `export function ChatMessage({ content }) { return <div style={{height: 80}}>{content}</div>; }`,
                    };
                });
            },
        }],
    });
    bundle = result.outputFiles[0]!.text;
});

type Row = {
    id: string;
    thread_id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments: unknown[];
    reasoning: null;
    model_id: null;
    reply_stats: null;
    created_at: string;
    deleted_at: null;
};

const THREAD_ID = '22222222-2222-4222-8222-222222222222';
function rows(count: number): Row[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `bbbbbbbb-bbbb-4bbb-8bbb-${index.toString(16).padStart(12, '0')}`,
        thread_id: THREAD_ID,
        role: index % 2 ? 'assistant' : 'user',
        content: index === 5 ? 'needle appears in this older result' : `message ${index}`,
        attachments: [],
        reasoning: null,
        model_id: null,
        reply_stats: null,
        created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        deleted_at: null,
    }));
}

async function openHarness(page: Page, seed: Row[]) {
    await page.addInitScript(initialRows => { window.__searchSeed = initialRows; }, seed);
    await page.route('**/__message_search_history__', route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><style>html,body,#root{height:100%;margin:0}.pt-4{padding-top:16px}.max-w-3xl{height:40px;box-sizing:border-box}.max-w-3xl p{margin:0}.pt-6{padding-top:0}.pb-2{padding-bottom:0}</style></head><body><div id="root"></div></body></html>',
    }));
    await page.goto('/__message_search_history__');
    await page.addScriptTag({ content: bundle });
}

test('search finds an older unloaded message and jumps to its highlighted row', async ({ page }) => {
    const seed = rows(120);
    await openHarness(page, seed);
    await expect.poll(() => page.evaluate(() => window.messageSearchHarness?.snapshot.ids.length)).toBe(50);
    await page.getByRole('textbox', { name: 'Search messages' }).fill('needle');
    const result = page.getByRole('button', { name: /Jump to assistant message: needle appears in this older result/ });
    await expect(result).toBeVisible();
    await result.click();
    await expect.poll(() => page.evaluate(id => window.messageSearchHarness.snapshot.ids.includes(id), seed[5]!.id)).toBe(true);
    await expect(page.locator(`#message-search-target[data-message-id="${seed[5]!.id}"]`)).toBeVisible();
    await page.screenshot({ path: 'test-results/message-search-desktop.png' });
    const requests = await page.evaluate(() => window.__messageSearchHistory.searchRequests);
    expect(requests.at(-1)).toEqual({
        threadId: THREAD_ID,
        columns: 'id,thread_id,role,content,created_at',
        pattern: '%needle%',
        limit: 20,
    });
    expect(await page.evaluate(() => window.__messageSearchHistory.pageRequests.length)).toBeGreaterThan(1);
    await page.evaluate(() => window.messageSearchHarness.scrollToBottom());
    await expect(page.locator(`.max-w-3xl[data-message-id="${seed.at(-1)!.id}"]`)).toBeVisible();
});

test('closing search cancels an in-flight older-page jump', async ({ page }) => {
    const seed = rows(120);
    await openHarness(page, seed);
    await expect.poll(() => page.evaluate(() => window.messageSearchHarness?.snapshot.ids.length)).toBe(50);
    await page.getByRole('textbox', { name: 'Search messages' }).fill('needle');
    const result = page.getByRole('button', { name: /Jump to assistant message: needle appears in this older result/ });
    await expect(result).toBeVisible();
    await page.evaluate(() => window.__messageSearchHistory.pauseOlderOnce());
    await result.click();
    await expect.poll(() => page.evaluate(() => window.__messageSearchHistory.pendingOlderPage !== null)).toBe(true);
    await page.getByRole('button', { name: 'Close search' }).click();
    await page.evaluate(() => window.__messageSearchHistory.releaseOlderPage());
    await expect.poll(() => page.evaluate(() => window.messageSearchHarness.snapshot.loadingOlder)).toBe(false);
    await expect.poll(() => page.evaluate(() => window.messageSearchHarness.snapshot.ids.length)).toBe(100);
    await expect(page.locator(`[data-message-id="${seed[5]!.id}"]`)).toHaveCount(0);
});
