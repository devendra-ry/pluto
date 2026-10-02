import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type {} from './fixtures/attachment-preview-harness';

let bundle: string;

test.beforeAll(async () => {
    const result = await build({
        entryPoints: [resolve('tests/e2e/fixtures/attachment-preview-harness.tsx')],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
        plugins: [{
            name: 'attachment-preview-browser-stubs',
            setup(builder) {
                builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'attachment-stub' }));
                builder.onResolve({ filter: /^@\/components\/ui\/button$/ }, () => ({ path: 'button', namespace: 'attachment-stub' }));
                builder.onResolve({ filter: /^@\/components\/ui\/dialog$/ }, () => ({ path: 'dialog', namespace: 'attachment-stub' }));
                builder.onResolve({ filter: /^@\/features\/attachments$/ }, () => ({ path: 'attachments', namespace: 'attachment-stub' }));
                builder.onLoad({ filter: /.*/, namespace: 'attachment-stub' }, (args) => {
                    if (args.path === 'image') return {
                        loader: 'tsx',
                        resolveDir: resolve('tests/e2e/fixtures'),
                        contents: `export default function Image(props) { return <img {...props} />; }`,
                    };
                    if (args.path === 'button') return {
                        loader: 'tsx',
                        resolveDir: resolve('tests/e2e/fixtures'),
                        contents: `export function Button({ variant, size, ...props }) { return <button {...props} />; }`,
                    };
                    if (args.path === 'dialog') return {
                        loader: 'tsx',
                        resolveDir: resolve('tests/e2e/fixtures'),
                        contents: `import React from 'react';
                            export function Dialog({ open, children }) { return open ? <div>{children}</div> : null; }
                            export function DialogContent({ children, ...props }) { return <section role="dialog" aria-modal="true" {...props}>{children}</section>; }
                            export function DialogDescription(props) { return <p {...props} />; }
                            export function DialogTitle(props) { return <h2 {...props} />; }`,
                    };
                    return { loader: 'js', resolveDir: resolve('tests/e2e/fixtures'), contents: `export function isLegacyAttachmentProxyUrl() { return false; }` };
                });
            },
        }],
    });
    bundle = result.outputFiles[0]!.text;
});

async function openHarness(page: Page) {
    await page.route('**/__attachments__', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><div id="root"></div></body></html>',
    }));
    await page.goto('/__attachments__');
    await page.addScriptTag({ content: bundle });
}

test('image attachments show a retryable error, recover, and open an accessible larger preview', async ({ page }) => {
    let requests = 0;
    await page.route('https://files.example.test/sample.png', async (route) => {
        requests += 1;
        if (requests === 1) await route.abort();
        else await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/WQAAAABJRU5ErkJggg==', 'base64') });
    });
    await openHarness(page);
    await expect(page.getByRole('alert')).toContainText('Image preview failed to load.');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('button', { name: 'Preview sample.png' })).toBeVisible();
    await page.getByRole('button', { name: 'Preview sample.png' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByAltText('sample.png')).toBeVisible();
    expect(requests).toBeGreaterThanOrEqual(2);
});

test('non-image attachments provide a named file link', async ({ page }) => {
    await openHarness(page);
    const link = page.getByRole('link', { name: 'Open notes.pdf' });
    await expect(link).toHaveAttribute('href', 'https://files.example.test/notes.pdf');
    await expect(link).toHaveAttribute('target', '_blank');
});
