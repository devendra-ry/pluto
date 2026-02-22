import { test, mock } from 'node:test';
import assert from 'node:assert';

// Set up env vars before any imports that might read them
process.env.GEMINI_API_KEY = 'dummy-key';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-key';
process.env.CHUTES_MEDIA_FETCH_ALLOWED_HOSTS = 'example.com';

// Import the function under test and the setter
const { fetchWithSsrfGuard, _setFetchImplementation } = await import('./ssrf-guard');

// Mock fetch
const mockFetch = mock.fn();

test('fetchWithSsrfGuard', async (t) => {
    t.beforeEach(() => {
        mockFetch.mock.resetCalls();
        // Inject the mock fetch
        _setFetchImplementation(mockFetch as any);
    });

    await t.test('fetches successfully for allowed host', async () => {
        mockFetch.mock.mockImplementation(async () => ({
            status: 200,
            headers: { get: () => null },
            text: async () => 'ok',
        }));

        const response = await fetchWithSsrfGuard('https://chutes.ai/image.png');
        assert.strictEqual(response.status, 200);
        assert.strictEqual(mockFetch.mock.callCount(), 1);
        const [url] = mockFetch.mock.calls[0].arguments;
        assert.strictEqual((url as URL).href, 'https://chutes.ai/image.png');
    });

    await t.test('throws for disallowed host', async () => {
        await assert.rejects(
            fetchWithSsrfGuard('https://evil.com/image.png'),
            /Remote host is not allowed: evil.com/
        );
        assert.strictEqual(mockFetch.mock.callCount(), 0);
    });

    await t.test('throws for non-HTTPS URL', async () => {
        await assert.rejects(
            fetchWithSsrfGuard('http://chutes.ai/image.png'),
            /Only HTTPS remote media URLs are allowed/
        );
        assert.strictEqual(mockFetch.mock.callCount(), 0);
    });

    await t.test('throws for URL with credentials', async () => {
        await assert.rejects(
            fetchWithSsrfGuard('https://user:pass@chutes.ai/image.png'),
            /Credentials are not allowed in remote media URLs/
        );
        assert.strictEqual(mockFetch.mock.callCount(), 0);
    });

    await t.test('fetches successfully for allowed extra host', async () => {
        mockFetch.mock.mockImplementation(async () => ({
            status: 200,
            headers: { get: () => null },
            text: async () => 'ok',
        }));

        // 'example.com' is allowed via env var CHUTES_MEDIA_FETCH_ALLOWED_HOSTS
        const response = await fetchWithSsrfGuard('https://example.com/image.png');
        assert.strictEqual(response.status, 200);
        assert.strictEqual(mockFetch.mock.callCount(), 1);
    });

    await t.test('handles redirects safely', async () => {
        let callCount = 0;
        mockFetch.mock.mockImplementation(async (url: any) => {
            callCount++;
            if (url.toString().includes('redirect')) {
                return {
                    status: 302,
                    headers: { get: (key: string) => key === 'location' ? 'https://chutes.ai/target' : null },
                    text: async () => 'redirecting',
                };
            }
            return {
                status: 200,
                headers: { get: () => null },
                text: async () => 'ok',
            };
        });

        const response = await fetchWithSsrfGuard('https://chutes.ai/redirect');
        assert.strictEqual(response.status, 200);
        assert.strictEqual(callCount, 2);
        const calls = mockFetch.mock.calls;
        assert.strictEqual((calls[0].arguments[0] as URL).href, 'https://chutes.ai/redirect');
        assert.strictEqual((calls[1].arguments[0] as URL).href, 'https://chutes.ai/target');
    });

    await t.test('throws for redirect to disallowed host', async () => {
        mockFetch.mock.mockImplementation(async () => ({
            status: 302,
            headers: { get: (key: string) => key === 'location' ? 'https://evil.com/target' : null },
            text: async () => 'redirecting',
        }));

        await assert.rejects(
            fetchWithSsrfGuard('https://chutes.ai/redirect'),
            /Remote host is not allowed: evil.com/
        );
        // Only one call, the redirect target validation fails before second fetch
        assert.strictEqual(mockFetch.mock.callCount(), 1);
    });

    await t.test('throws for redirect loop', async () => {
        mockFetch.mock.mockImplementation(async () => ({
            status: 302,
            headers: { get: (key: string) => key === 'location' ? 'https://chutes.ai/redirect' : null },
            text: async () => 'redirecting',
        }));

        await assert.rejects(
            fetchWithSsrfGuard('https://chutes.ai/redirect', { maxRedirects: 2 }),
            /Too many redirects while fetching remote media/
        );
        // Initial + 2 redirects = 3 calls
        assert.strictEqual(mockFetch.mock.callCount(), 3);
    });

    await t.test('throws if redirect missing location header', async () => {
        mockFetch.mock.mockImplementation(async () => ({
            status: 302,
            headers: { get: () => null }, // No location
            text: async () => 'redirecting',
        }));

        await assert.rejects(
            fetchWithSsrfGuard('https://chutes.ai/redirect'),
            /Remote media redirect is missing a Location header/
        );
    });
});
