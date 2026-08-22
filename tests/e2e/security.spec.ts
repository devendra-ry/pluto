import { expect, test } from '@playwright/test';

test('document responses carry a nonced strict-dynamic CSP', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response).not.toBeNull();

    const csp = response!.headers()['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toContain("'strict-dynamic'");
    // The whole point of the nonce policy: no blanket inline scripts.
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");

    // Next.js must propagate the request nonce into its bootstrap scripts,
    // otherwise they would be blocked by their own policy. Assert against
    // the raw HTML: browsers strip nonce attributes from the live DOM.
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    const html = await response!.text();
    expect(html).toContain(`nonce="${nonce}"`);
});
