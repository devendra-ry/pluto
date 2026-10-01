import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type {} from './fixtures/streaming-harness';

let bundle: string;
test.beforeAll(async () => {
    const result = await build({
        entryPoints: [resolve('tests/e2e/fixtures/streaming-harness.tsx')], bundle: true, write: false,
        format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
        plugins: [{
            name: 'playback-only-thread-metadata',
            setup(builder) {
                // Isolate the real streaming hook from unrelated database writes.
                builder.onResolve({ filter: /^@\/features\/threads$/ }, () => ({ path: 'threads', namespace: 'playback' }));
                builder.onLoad({ filter: /.*/, namespace: 'playback' }, () => ({
                    contents: 'export async function updateThreadTitleIfNewChat() {} export function sanitizeThreadTitle(s) { return s; }',
                }));
            },
        }],
    });
    bundle = result.outputFiles[0]!.text;
});

async function openPlayback(page: Page, failuresBeforeStream = 0) {
    await page.route('**/__streaming_playback__', route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><div id="root"></div></body></html>',
    }));
    await page.goto('/__streaming_playback__');
    await page.addScriptTag({ content: bundle });
    await expect(page.getByTestId('loading')).toHaveText('false');
    await page.evaluate((failures) => {
        window.streamingTest.failuresBeforeStream = failures;
        window.streamingTest.start();
    }, failuresBeforeStream);
}

test('reasoning and answer appear while the stream remains open and finish with exact Unicode text', async ({ page }) => {
    await openPlayback(page);
    await expect(page.getByTestId('loading')).toHaveText('true');
    await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
    await page.evaluate(() => window.streamingTest.delta('', 'Think 🧠 carefully.'));
    await expect(page.locator('.prose').filter({ hasText: 'Think 🧠 carefully.' })).toBeVisible();
    await page.evaluate(() => window.streamingTest.delta('Answer 👩🏽‍💻: café.'));
    await expect(page.locator('.prose').filter({ hasText: 'Answer 👩🏽‍💻: café.' })).toBeVisible();
    await expect(page.getByTestId('loading')).toHaveText('true');
    await page.evaluate(() => window.streamingTest.finish());
    await expect(page.getByTestId('loading')).toHaveText('false');
    await expect(page.getByTestId('committed')).toContainText('Think 🧠 carefully.');
    await expect(page.getByTestId('committed')).toContainText('Answer 👩🏽‍💻: café.');
    await expect(page.locator('.prose').filter({ hasText: 'Answer 👩🏽‍💻: café.' })).toBeVisible();
});

test('collapsed reasoning does not rerender the message for hidden token updates', async ({ page }) => {
    await openPlayback(page);
    await expect(page.getByTestId('loading')).toHaveText('true');
    await page.evaluate(() => window.streamingTest.publish('', 'Initial thought'));
    await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toBeVisible();
    const before = await page.evaluate(() => window.streamingTest.commits);
    await page.evaluate(() => {
        for (let index = 0; index < 100; index += 1) window.streamingTest.publish('', `Hidden thought ${index}`);
    });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.evaluate(() => window.streamingTest.commits)).toBe(before);
    await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
    await expect(page.locator('.prose')).toHaveText('Hidden thought 99');
});

test('reasoning can resume after an answer part without dropping the earlier thought', async ({ page }) => {
    await openPlayback(page);
    await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
    await page.evaluate(() => window.streamingTest.delta('', 'First thought.'));
    await expect(page.locator('.prose').filter({ hasText: 'First thought.' })).toBeVisible();
    await page.evaluate(() => window.streamingTest.delta('First answer.'));
    await expect(page.locator('.prose').filter({ hasText: 'First answer.' })).toBeVisible();
    await page.evaluate(() => window.streamingTest.delta('', ' Second thought.'));
    await expect(page.locator('.prose').filter({ hasText: 'First thought. Second thought.' })).toBeVisible();
    await page.evaluate(() => window.streamingTest.finish());
    await expect(page.locator('.prose').filter({ hasText: 'First thought. Second thought.' })).toBeVisible();
});

test('a failed stream preserves reasoning and answer already received', async ({ page }) => {
    await openPlayback(page);
    await page.evaluate(() => window.streamingTest.delta('Useful partial answer', 'Useful reasoning'));
    await expect(page.locator('.prose')).toContainText('Useful partial answer');
    await page.evaluate(() => window.streamingTest.fail());
    await expect(page.getByTestId('loading')).toHaveText('false');
    await expect(page.getByTestId('failed')).toHaveText('true');
    await expect(page.getByTestId('committed')).toContainText('Useful reasoning');
    await expect(page.locator('.prose')).toContainText('Useful partial answer');
});

test('stopping flushes pending answer deltas without retrying the request', async ({ page }) => {
    await openPlayback(page);
    await page.evaluate(() => window.streamingTest.delta('First '));
    await expect(page.locator('.prose')).toHaveText('First');
    await page.evaluate(async () => {
        window.streamingTest.delta('second 🧠');
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        window.streamingTest.stop();
    });
    await expect(page.getByTestId('loading')).toHaveText('false');
    await expect(page.locator('.prose')).toHaveText('First second 🧠');
    expect(await page.evaluate(() => window.streamingTest.requests)).toBe(1);
});

test('a recovered request resolves its original caller with the recovery result', async ({ page }) => {
    await openPlayback(page, 1);
    await expect.poll(() => page.evaluate(() => window.streamingTest.requests)).toBe(2);
    await page.evaluate(() => { window.streamingTest.delta('Recovered answer'); window.streamingTest.finish(); });
    await expect.poll(() => page.evaluate(() => window.streamingTest.result)).toBe(true);
    await expect(page.locator('.prose')).toHaveText('Recovered answer');
});

test('automatic regeneration is bounded when both requests cannot resume', async ({ page }) => {
    await openPlayback(page, 10);
    await expect.poll(() => page.evaluate(() => window.streamingTest.result)).toBe(false);
    expect(await page.evaluate(() => window.streamingTest.requests)).toBe(2);
    await expect(page.getByTestId('failed')).toHaveText('true');
});
