import { expect, test } from '@playwright/test';

test('unauthenticated chat route redirects to login', async ({ page }) => {
    await page.goto('/c/some-thread-id');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in to Pluto' })).toBeVisible();
});

test('unauthenticated chat API responds 401 JSON', async ({ request }) => {
    const response = await request.post('/api/chat', {
        data: { messages: [{ role: 'user', content: 'hello' }], model: 'test' },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBeTruthy();
});
