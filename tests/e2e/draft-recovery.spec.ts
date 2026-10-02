import { expect, test } from '@playwright/test';

test('home draft survives reload and can be discarded', async ({ page }) => {
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('A draft to recover');
    await page.waitForTimeout(450);
    await page.reload();
    await expect(composer).toHaveValue('A draft to recover');
    await expect(page.getByRole('status').filter({ hasText: 'Draft restored' })).toBeVisible();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(composer).toHaveValue('');
    await page.reload();
    await expect(composer).toHaveValue('');
});

test('home recovery stays separate from a thread draft', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('pluto:text-drafts:v1', JSON.stringify([
            { userId: null, scopeId: 'home', text: 'Home only', updatedAt: Date.now() },
            { userId: null, scopeId: 'thread-1', text: 'Thread only', updatedAt: Date.now() },
        ]));
    });
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(composer).toHaveValue('Home only');
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    const savedDrafts = await page.evaluate(() => JSON.parse(localStorage.getItem('pluto:text-drafts:v1') ?? '[]')) as Array<{ scopeId: string; text: string }>;
    expect(savedDrafts).toEqual([{ userId: null, scopeId: 'thread-1', text: 'Thread only', updatedAt: expect.any(Number) }]);
});

test('New Chat clears the persisted home draft on the home route', async ({ page }) => {
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Clear me with New Chat');
    await page.waitForTimeout(450);
    await page.getByRole('button', { name: 'New Chat', exact: true }).click();
    await expect(composer).toHaveValue('');
    await page.reload();
    await expect(composer).toHaveValue('');
});

test('blocked draft storage keeps the composer usable', async ({ page }) => {
    await page.addInitScript(() => {
        const get = Storage.prototype.getItem;
        const set = Storage.prototype.setItem;
        const remove = Storage.prototype.removeItem;
        const key = 'pluto:text-drafts:v1';
        Storage.prototype.getItem = function (name) {
            if (name === key) throw new DOMException('Storage blocked', 'SecurityError');
            return get.call(this, name);
        };
        Storage.prototype.setItem = function (name, value) {
            if (name === key) throw new DOMException('Storage blocked', 'SecurityError');
            return set.call(this, name, value);
        };
        Storage.prototype.removeItem = function (name) {
            if (name === key) throw new DOMException('Storage blocked', 'SecurityError');
            return remove.call(this, name);
        };
    });
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Still usable');
    await expect(composer).toHaveValue('Still usable');
});

test('failed submit restores the draft after its composer was optimistically cleared', async ({ page }) => {
    await page.route('**/rest/v1/rpc/start_chat_with_message', route => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Test service unavailable' }),
    }));
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Retry this message');
    await composer.press('Enter');
    await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('alert')).toContainText('Test service unavailable');
    await expect(composer).toHaveValue('Retry this message');
});
