const DISPLAY_LATEX = /\\+\[([\s\S]*?)\\+\]/g;
const INLINE_LATEX = /\\+\(([\s\S]*?)\\+\)/g;

interface FenceState {
    marker: '`' | '~';
    length: number;
    containerPrefix: string;
}

interface StructuralLine {
    containerPrefix: string;
    content: string;
}

function splitLines(source: string): string[] {
    return source.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) ?? [];
}

function splitLineEnding(line: string): { body: string; ending: string } {
    if (line.endsWith('\r\n')) return { body: line.slice(0, -2), ending: '\r\n' };
    if (line.endsWith('\n') || line.endsWith('\r')) return { body: line.slice(0, -1), ending: line.slice(-1) };
    return { body: line, ending: '' };
}

function stripBlockQuotePrefixes(line: string): { prefix: string; content: string } {
    let offset = 0;
    const quotePrefix = / {0,3}>[ \t]?/y;
    while (offset < line.length) {
        quotePrefix.lastIndex = offset;
        const match = quotePrefix.exec(line);
        if (!match) break;
        offset = quotePrefix.lastIndex;
    }
    return { prefix: line.slice(0, offset), content: line.slice(offset) };
}

function getStructuralLine(line: string): StructuralLine {
    const { prefix: quotePrefix, content: afterQuote } = stripBlockQuotePrefixes(line);
    const listMarker = /^( {0,3})(?:[*+-]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(afterQuote);
    if (!listMarker) return { containerPrefix: quotePrefix, content: afterQuote };

    const continuationIndent = listMarker[1]!.length + listMarker[0]!.length - listMarker[3]!.length;
    return {
        containerPrefix: `${quotePrefix}${' '.repeat(continuationIndent)}`,
        content: listMarker[3]!,
    };
}

function parseOpeningFence(line: string): FenceState | null {
    const { containerPrefix, content } = getStructuralLine(line);
    const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(content);
    if (!opening) return null;
    const marker = opening[2]![0] as '`' | '~';
    const length = opening[2]!.length;
    if (marker === '`' && opening[3]!.includes('`')) return null;
    return { marker, length, containerPrefix };
}

function closesFence(line: string, fence: FenceState): boolean {
    if (!line.startsWith(fence.containerPrefix)) return false;
    const content = line.slice(fence.containerPrefix.length);
    const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(content);
    return Boolean(closing && closing[1]![0] === fence.marker && closing[1]!.length >= fence.length);
}

function transformLatex(text: string): string {
    return text
        .replace(DISPLAY_LATEX, (_match, equation: string) => `\n$$\n${equation}\n$$\n`)
        .replace(INLINE_LATEX, (_match, equation: string) => `$${equation}$`);
}

function isEscaped(text: string, index: number): boolean {
    let backslashes = 0;
    for (let position = index - 1; position >= 0 && text[position] === '\\'; position -= 1) {
        backslashes += 1;
    }
    return backslashes % 2 === 1;
}

function findMatchingBacktickRun(text: string, from: number, length: number): number {
    for (let index = from; index < text.length;) {
        const next = text.indexOf('`', index);
        if (next === -1) return -1;
        let end = next + 1;
        while (text[end] === '`') end += 1;
        if (end - next === length) return next;
        index = end;
    }
    return -1;
}

function transformProse(text: string): string {
    let output = '';
    let proseStart = 0;
    let index = 0;

    while (index < text.length) {
        if (text[index] !== '`' || isEscaped(text, index)) {
            index += 1;
            continue;
        }

        let runEnd = index + 1;
        while (text[runEnd] === '`') runEnd += 1;
        const matchingRun = findMatchingBacktickRun(text, runEnd, runEnd - index);
        if (matchingRun === -1) {
            index = runEnd;
            continue;
        }

        let closingEnd = matchingRun + 1;
        while (text[closingEnd] === '`') closingEnd += 1;
        output += transformLatex(text.slice(proseStart, index));
        output += text.slice(index, closingEnd);
        proseStart = closingEnd;
        index = closingEnd;
    }

    return output + transformLatex(text.slice(proseStart));
}

/** Convert supported LaTeX delimiters in prose while leaving Markdown code verbatim. */
export function preprocessMarkdownSource(source: string): string {
    if (!source) return source;

    const output: string[] = [];
    let prose: string[] = [];
    let fence: FenceState | null = null;

    const flushProse = () => {
        if (prose.length === 0) return;
        output.push(transformProse(prose.join('')));
        prose = [];
    };

    for (const line of splitLines(source)) {
        const { body, ending } = splitLineEnding(line);

        if (fence) {
            output.push(line);
            if (closesFence(body, fence)) fence = null;
            continue;
        }

        const openingFence = parseOpeningFence(body);
        if (openingFence) {
            flushProse();
            output.push(line);
            fence = openingFence;
            continue;
        }

        const { content } = getStructuralLine(body);
        if (/^(?: {4,}|\t)/.test(content)) {
            flushProse();
            output.push(line);
            continue;
        }

        // Blank lines cannot contain math delimiters, but retaining them with
        // adjacent prose preserves multi-line inline code span matching.
        prose.push(body, ending);
    }

    flushProse();
    return output.join('');
}
