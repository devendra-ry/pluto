import { expect, test } from '@playwright/test';

test('login page presents the Google sign-in entry point', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in to dev Chat' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});
