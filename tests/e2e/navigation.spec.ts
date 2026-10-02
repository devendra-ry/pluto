import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    // The cases below cover client navigation only and must never reach Supabase.
    await page.route('https://example.supabase.co/**', (route) => route.abort());
});

test('mobile conversation navigation closes with Escape and returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const openSidebar = page.getByRole('button', { name: 'Expand sidebar' });
    await expect(openSidebar).toBeVisible();
    await openSidebar.click();

    const navigation = page.getByRole('dialog', { name: 'Conversation navigation' });
    await expect(navigation).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search conversations' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(navigation).toHaveCount(0);
    await expect(openSidebar).toBeFocused();
});

test('New Chat clears the home composer when the route is already home', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.fill('A draft that should be cleared');
    await page.getByRole('button', { name: 'New Chat', exact: true }).click();
    await expect(composer).toHaveValue('');
});

test('login shows a recoverable message after the OAuth callback fails', async ({ page }) => {
    await page.goto('/login?error=auth_failed');

    await expect(page.locator('p[role="alert"]')).toHaveText('Google sign-in could not be completed. Please try again.');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
});
