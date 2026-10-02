import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type { Thread } from '../../src/shared/contracts/thread';
import type {} from './fixtures/thread-prefetch-harness';
import type {} from './fixtures/thread-prefetch-mock';

let bundle: string;

test.beforeAll(async () => {
    const result = await build({
        entryPoints: [resolve('tests/e2e/fixtures/thread-prefetch-harness.tsx')],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
        plugins: [{
            name: 'mock-thread-prefetch-supabase',
            setup(builder) {
                builder.onResolve({ filter: /^@\/shared\/lib\/supabase\/client$/ }, () => ({
                    path: resolve('tests/e2e/fixtures/thread-prefetch-mock.ts'),
                }));
            },
        }],
    });
    bundle = result.outputFiles[0]!.text;
});

const THREAD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THREAD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const THREAD_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function prefetchedThread(id: string, title: string): Thread {
    return {
        id,
        title,
        model: 'gemini-2.5-flash',
        system_prompt: null,
        is_pinned: false,
        created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
        user_id: '11111111-1111-4111-8111-111111111111',
    };
}

async function openHarness(page: Page, id: string, initialThread: Thread | null) {
    await page.addInitScript(seed => { window.__threadPrefetchSeed = seed; }, { id, initialThread });
    await page.route('**/__thread_prefetch__', route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><div id="root"></div></body></html>',
    }));
    await page.goto('/__thread_prefetch__');
    await page.addScriptTag({ content: bundle });
}

test('matching server-prefetched thread renders without a duplicate SELECT', async ({ page }) => {
    await openHarness(page, THREAD_A, prefetchedThread(THREAD_A, 'Server prefetched chat'));

    await expect(page.getByLabel('Current thread')).toHaveText('Server prefetched chat');
    await expect.poll(() => page.evaluate(() => window.threadPrefetchHarness?.snapshot.title)).toBe('Server prefetched chat');
    expect(await page.evaluate(() => window.__threadPrefetchMock.requests)).toEqual([]);
});

test('mismatched initial thread is never visible on the first layout commit', async ({ page }) => {
    await page.addInitScript(id => { window.__threadPrefetchPausedIds = [id]; }, THREAD_B);
    await openHarness(page, THREAD_B, prefetchedThread(THREAD_A, 'Wrong previous chat'));

    await expect.poll(() => page.evaluate(() => window.threadPrefetchHarness?.firstCommit.id)).toBe(THREAD_B);
    expect(await page.evaluate(() => window.threadPrefetchHarness.firstCommit)).toEqual({
        id: THREAD_B,
        renderedId: null,
        title: null,
    });
    await expect(page.getByLabel('Current thread')).not.toContainText('Wrong previous chat');
    await expect.poll(() => page.evaluate(() => window.__threadPrefetchMock.requests.length)).toBe(1);
    await page.evaluate(id => window.__threadPrefetchMock.release(id), THREAD_B);
    await expect(page.getByLabel('Current thread')).toHaveText(`Fetched ${THREAD_B.slice(0, 4)}`);
});

test('thread loads from the database when there is no server-prefetched row', async ({ page }) => {
    await openHarness(page, THREAD_C, null);

    await expect(page.getByLabel('Current thread')).toHaveText(`Fetched ${THREAD_C.slice(0, 4)}`);
    expect(await page.evaluate(() => window.__threadPrefetchMock.requests)).toEqual([{
        table: 'threads',
        columns: 'id,title,model,reasoning_effort,system_prompt,is_pinned,created_at,updated_at,user_id',
        id: THREAD_C,
    }]);
});

test('late fetch from a previous route cannot replace a matching new prefetch', async ({ page }) => {
    await page.addInitScript(id => { window.__threadPrefetchPausedIds = [id]; }, THREAD_A);
    await openHarness(page, THREAD_A, null);
    await expect.poll(() => page.evaluate(() => window.__threadPrefetchMock.requests.length)).toBe(1);

    await page.evaluate(({ id, thread }) => window.threadPrefetchHarness.navigate(id, thread), {
        id: THREAD_B,
        thread: prefetchedThread(THREAD_B, 'New route prefetch'),
    });
    await expect(page.getByLabel('Current thread')).toHaveText('New route prefetch');
    await page.evaluate(id => window.__threadPrefetchMock.release(id), THREAD_A);
    await expect(page.getByLabel('Current thread')).toHaveText('New route prefetch');
    expect(await page.evaluate(() => window.__threadPrefetchMock.requests.map(request => request.id))).toEqual([THREAD_A]);
});
