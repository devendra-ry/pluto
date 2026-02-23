import { test } from 'node:test';
import assert from 'node:assert';

// Set up env vars for ssrf-guard dependencies
process.env.GEMINI_API_KEY = 'dummy-key';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-key';

// Dynamic import to ensure environment variables are picked up
const { assertSafeRemoteUrl } = await import('./ssrf-guard');

test('assertSafeRemoteUrl', async (t) => {
    await t.test('accepts valid HTTPS URLs with allowed hostnames', async () => {
        const allowed = ['example.com'];
        const url = 'https://example.com/image.png';
        const parsed = await assertSafeRemoteUrl(url, allowed);
        assert.strictEqual(parsed.href, url);
    });

    await t.test('rejects invalid URL strings', async () => {
        const allowed = ['example.com'];
        await assert.rejects(
            async () => assertSafeRemoteUrl('not-a-url', allowed),
            /Invalid remote media URL/
        );
    });

    await t.test('rejects non-HTTPS protocols', async () => {
        const allowed = ['example.com'];
        await assert.rejects(
            async () => assertSafeRemoteUrl('http://example.com/image.png', allowed),
            /Only HTTPS remote media URLs are allowed/
        );
        await assert.rejects(
            async () => assertSafeRemoteUrl('ftp://example.com/image.png', allowed),
            /Only HTTPS remote media URLs are allowed/
        );
    });

    await t.test('rejects URLs with credentials', async () => {
        const allowed = ['example.com'];
        await assert.rejects(
            async () => assertSafeRemoteUrl('https://user:pass@example.com/image.png', allowed),
            /Credentials are not allowed in remote media URLs/
        );
        await assert.rejects(
            async () => assertSafeRemoteUrl('https://user@example.com/image.png', allowed),
            /Credentials are not allowed in remote media URLs/
        );
    });

    await t.test('rejects disallowed hostnames', async () => {
        const allowed = ['example.com'];
        await assert.rejects(
            async () => assertSafeRemoteUrl('https://malicious.com/image.png', allowed),
            /Remote host is not allowed: malicious.com/
        );
    });

    await t.test('accepts exact matches in allowed patterns', async () => {
        const allowed = ['example.com', 'sub.domain.com'];
        const url1 = 'https://example.com/image.png';
        const url2 = 'https://sub.domain.com/image.png';

        const parsed1 = await assertSafeRemoteUrl(url1, allowed);
        assert.strictEqual(parsed1.href, url1);

        const parsed2 = await assertSafeRemoteUrl(url2, allowed);
        assert.strictEqual(parsed2.href, url2);
    });

    await t.test('accepts wildcard matches in allowed patterns', async () => {
        const allowed = ['*.example.com'];

        // Exact suffix match
        const url1 = 'https://sub.example.com/image.png';
        const parsed1 = await assertSafeRemoteUrl(url1, allowed);
        assert.strictEqual(parsed1.href, url1);

        // Nested subdomain match (implementation check: likely allows it based on suffix check)
        const url2 = 'https://deep.sub.example.com/image.png';
        const parsed2 = await assertSafeRemoteUrl(url2, allowed);
        assert.strictEqual(parsed2.href, url2);

        // Base domain match?
        // The implementation: `host === suffix || host.endsWith(`.${suffix}`)`
        // pattern `*.example.com` -> suffix `example.com`
        // host `example.com` === suffix `example.com` -> true
        const url3 = 'https://example.com/image.png';
        const parsed3 = await assertSafeRemoteUrl(url3, allowed);
        assert.strictEqual(parsed3.href, url3);
    });

    await t.test('rejects localhost and local domains even if allowed', async () => {
        // Even if we explicitly allow localhost in patterns (which shouldn't happen usually but for testing robustness)
        const allowed = ['localhost', '*.localdomain'];

        await assert.rejects(
            async () => assertSafeRemoteUrl('https://localhost/image.png', allowed),
            /Remote host is not allowed: localhost/
        );

        await assert.rejects(
            async () => assertSafeRemoteUrl('https://foo.localhost/image.png', allowed),
            /Remote host is not allowed: foo.localhost/
        );
    });

    await t.test('is case insensitive for hostname', async () => {
        const allowed = ['example.com'];
        const url = 'https://EXAMPLE.COM/image.png';
        const parsed = await assertSafeRemoteUrl(url, allowed);
        // Parsed URL normalizes hostname to lowercase
        assert.strictEqual(parsed.hostname, 'example.com');
    });

    await t.test('removes trailing dot from hostname', async () => {
        const allowed = ['example.com'];
        // URL with trailing dot is valid FQDN
        const url = 'https://example.com./image.png';
        const parsed = await assertSafeRemoteUrl(url, allowed);
        assert.strictEqual(parsed.hostname, 'example.com.');
        // The check inside assertSafeRemoteUrl strips the dot for verification
    });
});
