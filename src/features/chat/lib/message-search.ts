export function escapeMessageSearchPattern(value: string) {
    return value.replace(/[\\%_]/g, '\\$&');
}

export function createMessageSearchSnippet(content: string, term: string, maxLength = 180) {
    const normalizedContent = content.replace(/\s+/g, ' ').trim();
    if (!normalizedContent) return 'Message contains attachments';
    const matchIndex = normalizedContent.toLocaleLowerCase().indexOf(term.trim().toLocaleLowerCase());
    if (normalizedContent.length <= maxLength) return normalizedContent;
    if (matchIndex < 0) return `${normalizedContent.slice(0, maxLength - 1)}…`;

    const context = Math.max(16, Math.floor((maxLength - term.length) / 2));
    const start = Math.max(0, matchIndex - context);
    const end = Math.min(normalizedContent.length, start + maxLength);
    return `${start > 0 ? '…' : ''}${normalizedContent.slice(start, end)}${end < normalizedContent.length ? '…' : ''}`;
}
