import { expect, test } from '@playwright/test';

test('mobile sidebar slides at full width and dismisses through the backdrop', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const sidebar = page.locator('aside');
    const expand = page.getByRole('button', { name: 'Expand sidebar' });
    await expand.click();
    await expect.poll(() => sidebar.evaluate(element => Math.round(element.getBoundingClientRect().x))).toBe(0);
    const openWidth = await sidebar.evaluate(element => element.getBoundingClientRect().width);

    await page.mouse.click(350, 400);
    await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
    expect(await sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(openWidth);
    await expect.poll(() => sidebar.evaluate(element => Math.round(element.getBoundingClientRect().right))).toBe(0);
    expect(await sidebar.evaluate(element => element.inert)).toBe(true);
    await expect(expand).toBeVisible();
});

test('composer settles correctly after reversing a multiline resize', async ({ page }) => {
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(composer).toBeVisible();
    const originalHeight = await composer.evaluate(element => element.getBoundingClientRect().height);
    await composer.fill('A line of text\n'.repeat(8));
    await expect.poll(() => composer.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(originalHeight);
    await composer.fill('A short draft');
    await expect.poll(() => composer.evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(Math.round(originalHeight));
    await expect(composer).toHaveValue('A short draft');
});

test('reduced motion disables composer resizing and menu movement', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('A line of text\n'.repeat(8));
    expect(await composer.evaluate(element => element.getAnimations().length)).toBe(0);
    await page.getByRole('button', { name: 'System prompt', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    expect(await menu.evaluate(element => Number.parseFloat(getComputedStyle(element).animationDuration))).toBeLessThan(0.001);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
});
