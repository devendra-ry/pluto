/**
 * Finds standalone prose paragraphs that can be rendered once while the rest
 * of a response is still arriving. A blank line is not by itself a safe
 * Markdown boundary: references, code spans, math, and block constructs can
 * change how earlier source is parsed. Keep those constructs in the live tail.
 */
export function takeFinalizedParagraphs(source: string): { blocks: string[]; consumed: number } {
    const blocks: string[] = [];
    let consumed = 0;
    const separator = /\n[ \t]*\n+/g;
    let match: RegExpExecArray | null;

    while ((match = separator.exec(source)) !== null) {
        const rawBlock = source.slice(consumed, match.index);
        const block = rawBlock.trim();
        if (!block) {
            consumed = separator.lastIndex;
            continue;
        }

        // Only freeze one-line prose. The deliberately broad checks below
        // retain constructs whose meaning can depend on source outside this
        // block, even when a particular instance would happen to be safe.
        const hasBlockSyntax = /^(?:#{1,6}(?:\s|$)|>|[-*+]\s|\d+[.)]\s|```|~~~|\$\$)|\|.*\||\\\[|\\\(| {4}|\t/.test(block);
        const hasCrossBlockSyntax = /[\[\]`$<]/.test(block);
        if (/^(?: {4}|\t)/.test(rawBlock) || block.includes('\n') || hasBlockSyntax || hasCrossBlockSyntax) break;

        blocks.push(block);
        consumed = separator.lastIndex;
    }

    return { blocks, consumed };
}

/**
 * Plain one-line assistant text can be published as a paragraph without
 * invoking the Markdown parser. Keep the character set intentionally narrow:
 * syntax punctuation, entities, URLs, email addresses, and line structure all
 * fall back to ReactMarkdown.
 */
export function isPlainMarkdownParagraph(source: string): boolean {
    return !/^\d+[.)]\s/.test(source)
        && !/\bwww\.|\b[a-z][a-z0-9+.-]{1,31}:\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i.test(source)
        && /^[\p{L}\p{N}][\p{L}\p{M}\p{N}\p{Zs},.;:!?\u0027\u2019\u201c\u201d]*$/u.test(source);
}
