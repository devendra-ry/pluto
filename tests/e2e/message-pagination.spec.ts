import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type {} from './fixtures/message-pagination-harness';
import type {} from './fixtures/message-pagination-supabase-mock';

let bundle: string;

test.beforeAll(async () => {
    const result = await build({
        entryPoints: [resolve('tests/e2e/fixtures/message-pagination-harness.tsx')],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
        plugins: [{
            name: 'message-history-browser-mocks',
            setup(builder) {
                builder.onResolve({ filter: /^@\/shared\/lib\/supabase\/client$/ }, () => ({
                    path: resolve('tests/e2e/fixtures/message-pagination-supabase-mock.ts'),
                }));
                builder.onResolve({ filter: /^@\/shared\/lib\/query-client$/ }, () => ({
                    path: resolve('tests/e2e/fixtures/message-pagination-supabase-mock.ts'),
                }));
                builder.onResolve({ filter: /^\.\/chat-message$/ }, () => ({ path: 'chat-message', namespace: 'message-stub' }));
                builder.onLoad({ filter: /.*/, namespace: 'message-stub' }, () => ({
                    loader: 'tsx',
                    resolveDir: resolve('tests/e2e/fixtures'),
                    contents: `import React from 'react'; export function ChatMessage({ content }) { return <div style={{height: 134, boxSizing: 'border-box', borderBottom: '1px solid #ddd'}}>{content}</div>; }`,
                }));
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
    return Array.from({ length: count }, (_, index) => {
        const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
        return {
            id: `bbbbbbbb-bbbb-4bbb-8bbb-${index.toString(16).padStart(12, '0')}`,
            thread_id: THREAD_ID,
            role: index % 2 ? 'assistant' : 'user',
            content: `message ${index}`,
            attachments: [],
            reasoning: null,
            model_id: null,
            reply_stats: null,
            created_at: timestamp,
            deleted_at: null,
        };
    });
}

async function openHarness(page: Page, seed: Row[]) {
    await page.addInitScript((initialRows) => {
        window.__messageSeed = initialRows;
    }, seed);
    await page.route('**/__message_pagination__', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><style>html,body,#root{height:100%;margin:0}.pt-4{padding-top:16px}.max-w-3xl{height:40px;box-sizing:border-box}.max-w-3xl p{margin:0}.pt-6{padding-top:0}.pb-2{padding-bottom:0}</style></head><body><div id="root"></div></body></html>',
    }));
    await page.goto('/__message_pagination__');
    await page.addScriptTag({ content: bundle });
}

async function waitForMessages(page: Page, count: number) {
    await expect.poll(() => page.evaluate(() => window.messagePaginationHarness?.snapshot.ids.length)).toBe(count);
}

test('message history loads the newest page first and preserves its anchor during automatic prepend', async ({ page }) => {
    const seed = rows(151);
    await openHarness(page, seed);
    await waitForMessages(page, 50);
    const initial = await page.evaluate(() => window.messagePaginationHarness.snapshot);
    expect(initial.hasOlder).toBe(true);
    expect(initial.ids[0]).toBe(seed[101]!.id);
    expect(initial.ids.at(-1)).toBe(seed[150]!.id);
    await expect.poll(() => page.evaluate(() => window.__messageMock.requests.length)).toBe(1);

    const scroller = page.locator('[data-virtuoso-scroller]');
    await expect.poll(() => scroller.evaluate((element) => (element as HTMLElement).scrollTop)).toBeGreaterThan(0);
    await page.evaluate(() => window.__messageMock.pauseOlderOnce());
    const bounds = await scroller.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.wheel(0, -10_000);
    await expect.poll(() => page.evaluate(() => window.__messageMock.pendingOlderPage !== null)).toBe(true);
    const anchor = page.locator(`[data-message-id="${seed[101]!.id}"]`);
    await expect(anchor).toBeVisible();
    const beforeY = await anchor.evaluate((element) => element.getBoundingClientRect().top);
    await page.evaluate(() => window.__messageMock.releaseOlderPage());
    await waitForMessages(page, 100);
    await expect.poll(() => anchor.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(beforeY - 20);
    await expect.poll(() => anchor.evaluate((element) => element.getBoundingClientRect().top)).toBeLessThanOrEqual(beforeY + 20);

    const requests = await page.evaluate(() => window.__messageMock.requests);
    expect(requests[0]?.cursor).toBeNull();
    expect(requests[0]?.limit).toBe(51);
    expect(requests[1]?.cursor).toContain('created_at.lt.');
    expect(requests[1]?.limit).toBe(51);
});

test('an older-page failure can retry without advancing its cursor', async ({ page }) => {
    const seed = rows(100);
    await openHarness(page, seed);
    await waitForMessages(page, 50);
    await page.evaluate(async () => {
        window.__messageMock.failOlderOnce();
        await window.messagePaginationHarness.loadOlder();
    });
    const retryButton = page.getByRole('button', { name: 'Could not load older messages. Try again' });
    await expect(retryButton).toBeVisible();
    const failedCursor = await page.evaluate(() => window.__messageMock.requests.at(-1)?.cursor);
    await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Try again'));
        if (!button) throw new Error('Retry button was not mounted');
        button.click();
    });
    await waitForMessages(page, 100);
    const cursors = await page.evaluate(() => window.__messageMock.requests.map((request) => request.cursor));
    expect(cursors).toHaveLength(3);
    expect(cursors[1]).toBe(failedCursor);
    expect(cursors[2]).toBe(failedCursor);
});

test('a realtime interruption and an online event each reconcile missed messages', async ({ page }) => {
    const seed = rows(50);
    await openHarness(page, seed);
    await waitForMessages(page, 50);
    await expect.poll(() => page.evaluate(() => window.messagePaginationHarness.snapshot.syncStatus)).toBe('connected');

    const missedDuringDisconnect = { ...rows(51)[50]!, created_at: '2027-01-01T00:00:00.000Z' };
    await page.evaluate((row) => {
        window.__messageMock.insertWithoutRealtime(row);
        window.__messageMock.setStatus('CHANNEL_ERROR');
    }, missedDuringDisconnect);
    await expect.poll(() => page.evaluate(() => window.messagePaginationHarness.snapshot.syncStatus)).toBe('reconnecting');
    await page.evaluate(() => window.__messageMock.setStatus('SUBSCRIBED'));
    await expect.poll(() => page.evaluate((id) => window.messagePaginationHarness.snapshot.ids.includes(id), missedDuringDisconnect.id)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.messagePaginationHarness.snapshot.syncStatus)).toBe('connected');

    const missedWhileOnline = { ...rows(52)[51]!, created_at: '2027-01-01T00:01:00.000Z' };
    await page.evaluate((row) => window.__messageMock.insertWithoutRealtime(row), missedWhileOnline);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => page.evaluate((id) => window.messagePaginationHarness.snapshot.ids.includes(id), missedWhileOnline.id)).toBe(true);
    const recoveredIds = await page.evaluate(() => window.messagePaginationHarness.snapshot.ids);
    expect(recoveredIds).toContain(missedDuringDisconnect.id);
    expect(recoveredIds).toContain(missedWhileOnline.id);
});

test('a CLOSED realtime channel is replaced immediately when the browser comes online', async ({ page }) => {
    await openHarness(page, rows(50));
    await waitForMessages(page, 50);
    await expect.poll(() => page.evaluate(() => window.messagePaginationHarness.snapshot.syncStatus)).toBe('connected');
    await expect.poll(() => page.evaluate(() => window.__messageMock.channelCount())).toBe(1);
    await page.evaluate(() => window.__messageMock.setStatus('CLOSED'));
    await expect.poll(() => page.evaluate(() => window.messagePaginationHarness.snapshot.syncStatus)).toBe('reconnecting');

    const missed = { ...rows(51)[50]!, created_at: '2027-02-01T00:00:00.000Z' };
    await page.evaluate((row) => {
        window.__messageMock.insertWithoutRealtime(row);
        window.dispatchEvent(new Event('online'));
    }, missed);
    await expect.poll(() => page.evaluate(() => window.__messageMock.channelCount())).toBe(2);
    await expect.poll(() => page.evaluate((id) => window.messagePaginationHarness.snapshot.ids.includes(id), missed.id)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.messagePaginationHarness.snapshot.syncStatus)).toBe('connected');
});
