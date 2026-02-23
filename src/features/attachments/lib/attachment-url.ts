export function isLegacyAttachmentProxyUrl(url: string) {
    if (!url) return false;
    if (url.startsWith('/api/uploads?')) return true;
    try {
        const parsed = new URL(url, 'http://localhost');
        return parsed.pathname === '/api/uploads';
    } catch {
        return false;
    }
}
