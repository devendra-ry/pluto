import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import type {} from './fixtures/auth-state-harness';

let bundle: string;

test.beforeAll(async () => {
    const result = await build({
        entryPoints: [resolve('tests/e2e/fixtures/auth-state-harness.tsx')],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.css': 'empty' },
        alias: { '@': resolve('src') },
        define: {
            'process.env.NODE_ENV': '"development"',
            'process.env': '{}',
        },
        plugins: [{
            name: 'auth-state-browser-stubs',
            setup(buildApi) {
                buildApi.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'auth-state-stub' }));
                buildApi.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'auth-state-stub' }));
                buildApi.onResolve({ filter: /^@\/features\/threads$/ }, () => ({ path: 'threads', namespace: 'auth-state-stub' }));
                buildApi.onResolve({ filter: /^@\/shared\/lib\/supabase\/client$/ }, () => ({
                    path: resolve('tests/e2e/fixtures/auth-state-supabase-mock.ts'),
                }));
                buildApi.onLoad({ filter: /.*/, namespace: 'auth-state-stub' }, args => ({
                    contents: args.path === 'dynamic'
                        ? 'export default function dynamic() { return function DynamicStub() { return null; }; }'
                        : args.path === 'navigation'
                            ? 'export function useRouter() { return { refresh() { window.authStateMock.refreshCount += 1; } }; }'
                            : 'export const Sidebar = () => null;',
                    loader: 'tsx',
                }));
            },
        }],
    });
    bundle = result.outputFiles[0]!.text;
});

test('account changes clear composer, local drafts, and cached messages before child cleanup', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('pluto:text-drafts:v1', JSON.stringify([
            { userId: 'user-1', scopeId: 'home', text: 'Private user one draft', updatedAt: Date.now() },
        ]));
    });
    await page.route('**/__auth_state__', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body><div id="root"></div></body></html>',
    }));
    await page.goto('/__auth_state__');
    await page.addScriptTag({ content: bundle });

    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(composer).toHaveValue('Private user one draft');
    await page.evaluate(() => window.authStateMock.seedCacheSentinel());
    await expect(page.getByTestId('cache-sentinel')).toHaveText('cached-for-user-1');

    await page.evaluate(() => window.authStateMock.setUser('user-2'));
    await expect(page.getByText('Updating account…', { exact: true })).toBeVisible();
    await expect(composer).toHaveCount(0);
    await expect(page.getByTestId('cache-sentinel')).toHaveText('cleared');
    await expect.poll(() => page.evaluate(() => window.authStateMock.refreshCount)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('pluto:text-drafts:v1'))).toBeNull();
    // Let the old ChatInput's final unmount flush run; it must not resurrect
    // user-1's draft after the synchronous auth-change clear.
    await page.waitForTimeout(450);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('pluto:text-drafts:v1'))).toBeNull();

    await page.evaluate(() => window.authStateMock.confirmServerUser('user-2'));
    await expect(composer).toBeVisible();
    await expect(composer).toHaveValue('');
    await composer.fill('Private user two draft');
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('pluto:text-drafts:v1') ?? '[]')))
        .toEqual([{ userId: 'user-2', scopeId: 'home', text: 'Private user two draft', updatedAt: expect.any(Number) }]);

    await page.evaluate(() => window.authStateMock.setUser(null));
    await expect(page.getByText('Updating account…', { exact: true })).toBeVisible();
    await page.evaluate(() => window.authStateMock.confirmServerUser(null));
    await expect(composer).toHaveValue('');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('pluto:text-drafts:v1'))).toBeNull();
});
