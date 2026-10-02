import { expect, test } from '@playwright/test';

test('keyboard favoriting does not select the model or close the picker', async ({ page }) => {
    await page.goto('/');
    const selector = page.getByRole('button', { name: /^Choose model:/ });
    const originalName = await selector.getAttribute('aria-label');
    await selector.click();
    const favorite = page.getByRole('button', { name: /^Add .* to favorites$/ }).nth(1);
    const label = await favorite.getAttribute('aria-label');
    await favorite.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Search models' })).toBeVisible();
    await expect(page.getByRole('button', { name: label!.replace('Add ', 'Remove ').replace(' to ', ' from ') })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(selector).toHaveAttribute('aria-label', originalName!);
});

test('blocked preference storage keeps the composer and model picker usable', async ({ page }) => {
    await page.addInitScript(() => {
        const get = Storage.prototype.getItem;
        const set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
            if (key === 'starred-models' || key === 'sidebar-collapsed') throw new DOMException('Storage blocked', 'SecurityError');
            return get.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
            if (key === 'starred-models' || key === 'sidebar-collapsed') throw new DOMException('Storage blocked', 'SecurityError');
            set.call(this, key, value);
        };
    });
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A draft');
    await page.getByRole('button', { name: /^Choose model:/ }).click();
    await page.getByRole('button', { name: /^Add .* to favorites$/ }).first().click();
    await expect(page.getByRole('button', { name: /^Remove .* from favorites$/ }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('A draft');
});

test('system instructions support keyboard navigation, cancel, and focus restoration', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'System prompt', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Customize this conversation' });
    const instructions = dialog.getByRole('textbox', { name: 'System prompt instructions' });
    await expect(instructions).toBeFocused();
    await instructions.fill('An unsaved instruction');
    await instructions.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(instructions).toHaveValue('');
});

test('oversized files are rejected before any upload or draft creation', async ({ page }) => {
    let uploadRequests = 0;
    await page.route('**/api/uploads', route => { uploadRequests += 1; return route.abort(); });
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({
        name: 'too-large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(21 * 1024 * 1024),
    });
    await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('alert')).toContainText('20 MB per file');
    await expect(page.getByRole('button', { name: 'Remove too-large.txt' })).toHaveCount(0);
    expect(uploadRequests).toBe(0);
});

test('composer controls stay inside a narrow mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    for (const name of ['Attach file', 'Send message', 'System prompt']) {
        const bounds = await page.getByRole('button', { name, exact: true }).boundingBox();
        expect(bounds).toBeTruthy();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    await page.screenshot({ path: 'test-results/pluto-mobile.png' });
});

test('desktop starters populate and focus the composer', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('aside')).toBeVisible();
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await page.getByRole('button', { name: 'How does AI work?', exact: true }).click();
    await expect(composer).toHaveValue('How does AI work?');
    await expect(composer).toBeFocused();
    await composer.fill('');
    await page.screenshot({ path: 'test-results/pluto-desktop.png' });
});
