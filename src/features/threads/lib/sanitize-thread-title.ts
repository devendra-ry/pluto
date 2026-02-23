export function sanitizeThreadTitle(raw: string, maxBaseLength: number = 50): string {
    const cleaned = raw
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) {
        return 'New Chat';
    }

    if (cleaned.length > maxBaseLength) {
        return `${cleaned.slice(0, maxBaseLength)}...`;
    }

    return cleaned;
}
