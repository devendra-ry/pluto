import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type {} from './fixtures/thread-pagination-harness';
import type {} from './fixtures/thread-pagination-supabase-mock';

let bundle: string;

test.beforeAll(async () => {
    const result = await build({
        entryPoints: [resolve('tests/e2e/fixtures/thread-pagination-harness.tsx')],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
        plugins: [{
            name: 'mock-thread-supabase-client',
            setup(builder) {
                builder.onResolve({ filter: /^@\/shared\/lib\/supabase\/client$/ }, () => ({
                    path: resolve('tests/e2e/fixtures/thread-pagination-supabase-mock.ts'),
                }));
            },
        }],
    });
    bundle = result.outputFiles[0]!.text;
});

type Row = {
    id: string;
    title: string;
    model: string;
    reasoning_effort: null;
    system_prompt: null;
    is_pinned: boolean;
    created_at: string;
    updated_at: string;
    user_id: string;
};

const userId = '11111111-1111-4111-8111-111111111111';

function rows(count: number, titleFor: (index: number) => string = (index) => `Conversation ${index}`): Row[] {
    return Array.from({ length: count }, (_, index) => {
        const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
        return {
            id: `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, '0')}`,
            title: titleFor(index),
            model: 'test-model',
            reasoning_effort: null,
            system_prompt: null,
            is_pinned: false,
            created_at: timestamp,
            updated_at: timestamp,
            user_id: userId,
        };
    });
}

async function openHarness(page: Page, seed: Row[]) {
    await page.addInitScript((initialRows) => {
        window.__threadSeed = initialRows;
    }, seed);
    await page.route('**/__thread_pagination__', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><div id="root"></div></body></html>',
    }));
    await page.goto('/__thread_pagination__');
    await page.addScriptTag({ content: bundle });
}

async function waitForInitialRows(page: Page, count: number) {
    await expect.poll(() => page.evaluate(() => window.threadPaginationHarness?.snapshot.threadIds.length)).toBe(count);
}

test('a realtime reorder during load-more does not let its stale page overwrite the live row', async ({ page }) => {
    const seed = rows(51);
    await openHarness(page, seed);
    await waitForInitialRows(page, 50);
    const moved = { ...seed[0]!, updated_at: '2027-01-01T00:00:00.000Z' };

    await page.evaluate(() => {
        window.__threadMock.pausePaginationOnce();
        void window.threadPaginationHarness.loadMoreThreads();
    });
    await expect.poll(() => page.evaluate(() => window.__threadMock.pendingRequest !== null)).toBe(true);
    await page.evaluate((thread) => window.__threadMock.emitUpdate(thread), moved);
    await expect.poll(() => page.evaluate((id) => window.threadPaginationHarness.snapshot.threadTimes[id], moved.id)).toBe(moved.updated_at);

    const cursorAtStart = await page.evaluate(() => window.__threadMock.requests.at(-1)?.cursor);
    expect(cursorAtStart).toContain('updated_at.lt.');
    expect(cursorAtStart).toContain('id.lt.aaaaaaaa-aaaa-4aaa-8aaa-000000000001');
    await page.evaluate(() => window.__threadMock.releasePagination());
    await waitForInitialRows(page, 51);
    const snapshot = await page.evaluate(() => window.threadPaginationHarness.snapshot);
    expect(snapshot.threadIds.filter((id) => id === moved.id)).toHaveLength(1);
    expect(snapshot.threadTimes[moved.id]).toBe(moved.updated_at);
});

test('a failed page retry reuses the same cursor and then advances', async ({ page }) => {
    await openHarness(page, rows(51));
    await waitForInitialRows(page, 50);
    await page.evaluate(async () => {
        window.__threadMock.failPaginationOnce();
        await window.threadPaginationHarness.loadMoreThreads();
    });
    await expect.poll(() => page.evaluate(() => window.threadPaginationHarness.snapshot.loadMoreError)).toBeTruthy();
    const firstCursor = await page.evaluate(() => window.__threadMock.requests.at(-1)?.cursor);

    await page.evaluate(() => window.threadPaginationHarness.retryLoadMoreThreads());
    await waitForInitialRows(page, 51);
    const requests = await page.evaluate(() => window.__threadMock.requests.filter((request) => request.cursor).map((request) => request.cursor));
    expect(requests).toEqual([firstCursor, firstCursor]);
    expect(await page.evaluate(() => window.threadPaginationHarness.snapshot.loadMoreError)).toBeNull();
});

test('search deduplicates repeated page rows and ignores a stale query response', async ({ page }) => {
    const seed = rows(55, (index) => `alpha result ${index}`);
    await openHarness(page, seed);
    await waitForInitialRows(page, 50);
    await page.evaluate(() => window.threadPaginationHarness.setSearch('alpha'));
    await expect.poll(() => page.evaluate(() => window.threadPaginationHarness.snapshot.searchIds.length)).toBe(50);
    const firstSearchIds = await page.evaluate(() => window.threadPaginationHarness.snapshot.searchIds);
    const duplicatePage = [seed[54]!, seed[4]!, seed[3]!, seed[2]!, seed[1]!, seed[0]!];
    await page.evaluate((data) => window.__threadMock.forceNextPage(data), duplicatePage);
    await page.evaluate(() => window.threadPaginationHarness.loadMoreSearch());
    await expect.poll(() => page.evaluate(() => window.threadPaginationHarness.snapshot.searchIds.length)).toBe(55);
    let searchIds = await page.evaluate(() => window.threadPaginationHarness.snapshot.searchIds);
    expect(new Set(searchIds).size).toBe(searchIds.length);
    expect(searchIds).toEqual(expect.arrayContaining(firstSearchIds));

    const betaRow = { ...seed[0]!, title: 'beta result' };
    await page.evaluate((row) => window.__threadMock.emitUpdate(row), betaRow);
    await page.evaluate(() => {
        window.__threadMock.pauseSearchOnce('stale');
        window.threadPaginationHarness.setSearch('stale');
    });
    await expect.poll(() => page.evaluate(() => window.__threadMock.pendingSearches.some((pending) => pending.term === 'stale'))).toBe(true);
    await page.evaluate(() => window.threadPaginationHarness.setSearch('beta'));
    await expect.poll(() => page.evaluate(() => window.threadPaginationHarness.snapshot.searchIds.length)).toBe(1);
    await page.evaluate(() => window.__threadMock.releaseSearch('stale'));
    await expect.poll(() => page.evaluate(() => window.threadPaginationHarness.snapshot.searchIds.length)).toBe(1);
    searchIds = await page.evaluate(() => window.threadPaginationHarness.snapshot.searchIds);
    expect(searchIds).toEqual([betaRow.id]);
});

test('a CLOSED conversation channel is replaced on online and ignores its late events', async ({ page }) => {
    const seed = rows(51);
    await openHarness(page, seed);
    await waitForInitialRows(page, 50);
    await expect.poll(() => page.evaluate(() => window.__threadMock.channelCount())).toBe(1);
    await page.evaluate(() => window.__threadMock.setStatus('CLOSED'));

    const recovered = { ...rows(52)[51]!, updated_at: '2027-02-01T00:00:00.000Z' };
    await page.evaluate((thread) => {
        window.__threadMock.insertWithoutRealtime(thread);
        window.dispatchEvent(new Event('online'));
    }, recovered);
    await expect.poll(() => page.evaluate(() => window.__threadMock.channelCount())).toBe(2);
    await expect.poll(() => page.evaluate((id) => window.threadPaginationHarness.snapshot.threadIds.includes(id), recovered.id)).toBe(true);

    const staleUpdate = { ...recovered, updated_at: '2030-01-01T00:00:00.000Z' };
    await page.evaluate((thread) => window.__threadMock.emitUpdateOnChannel(0, thread), staleUpdate);
    await expect.poll(() => page.evaluate((id) => window.threadPaginationHarness.snapshot.threadTimes[id], recovered.id)).toBe(recovered.updated_at);
});
