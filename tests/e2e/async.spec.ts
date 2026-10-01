import { expect, test } from '@playwright/test';

test('a failed send cannot restore an old draft after the user edits and clears it', async ({ page }) => {
    let started!: () => void;
    const requestStarted = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const pendingResponse = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route('**/rest/v1/rpc/start_chat_with_message', async route => {
        requests += 1;
        started();
        await pendingResponse;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Test service unavailable' }) });
    });

    await page.goto('/');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Original message');
    // Dispatch in the same browser turn, before React can render the loading state.
    await composer.evaluate(element => {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    try {
        await requestStarted;
        await composer.fill('A newer draft');
        await composer.fill('');
    } finally {
        release();
    }
    await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('alert')).toContainText('Test service unavailable');
    await expect(composer).toHaveValue('');
    expect(requests).toBe(1);
});

test('a failed send restores an untouched draft', async ({ page }) => {
    await page.route('**/rest/v1/rpc/start_chat_with_message', route => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Test service unavailable' }),
    }));
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Keep this draft');
    await composer.press('Enter');
    await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('alert')).toContainText('Test service unavailable');
    await expect(composer).toHaveValue('Keep this draft');
});
