export interface SseLineDecoderOptions {
    label: string;
    warnAtChars?: number;
    maxBufferChars?: number;
    onWarning?: (message: string) => void;
}

const DEFAULT_WARN_AT_CHARS = 256 * 1024;
const DEFAULT_MAX_BUFFER_CHARS = 2 * 1024 * 1024;

export class SseLineDecoder {
    private readonly decoder = new TextDecoder();
    private readonly options: Required<Omit<SseLineDecoderOptions, 'onWarning'>> & Pick<SseLineDecoderOptions, 'onWarning'>;
    private buffer = '';
    private warned = false;

    constructor(options: SseLineDecoderOptions) {
        this.options = {
            label: options.label,
            warnAtChars: options.warnAtChars ?? DEFAULT_WARN_AT_CHARS,
            maxBufferChars: options.maxBufferChars ?? DEFAULT_MAX_BUFFER_CHARS,
            onWarning: options.onWarning,
        };
    }

    push(chunk: Uint8Array): string[] {
        this.buffer += this.decoder.decode(chunk, { stream: true });
        return this.drainCompleteLines();
    }

    finish(): string[] {
        this.buffer += this.decoder.decode();
        const lines = this.drainCompleteLines(true);
        if (this.buffer.length > 0) {
            lines.push(this.buffer);
            this.buffer = '';
        }
        return lines;
    }

    private drainCompleteLines(endOfStream = false): string[] {
        const lines: string[] = [];
        let lineStart = 0;
        const separator = /[\r\n]/g;
        let match: RegExpExecArray | null;
        while ((match = separator.exec(this.buffer)) !== null) {
            const newlineIndex = match.index;

            // A CR at the end of a chunk may be the first half of CRLF.
            if (this.buffer.charCodeAt(newlineIndex) === 13 && newlineIndex === this.buffer.length - 1 && !endOfStream) break;

            lines.push(this.buffer.substring(lineStart, newlineIndex));
            lineStart = newlineIndex + 1;
            if (this.buffer.charCodeAt(newlineIndex) === 13 && this.buffer.charCodeAt(lineStart) === 10) {
                lineStart++;
            }
            separator.lastIndex = lineStart;
        }
        if (lineStart > 0) this.buffer = this.buffer.substring(lineStart);
        this.assertBufferBound();
        return lines;
    }

    private assertBufferBound() {
        if (!this.warned && this.buffer.length > this.options.warnAtChars) {
            this.warned = true;
            this.options.onWarning?.(`[${this.options.label}] Large pending SSE buffer (${this.buffer.length} chars)`);
        }
        if (this.buffer.length > this.options.maxBufferChars) {
            throw new Error(`${this.options.label} SSE buffer overflow`);
        }
    }
}

export function readSseDataLine(line: string): string | null {
    if (!line.startsWith('data:')) return null;
    const value = line.slice(5);
    return value.startsWith(' ') ? value.slice(1) : value;
}

export interface SseEvent {
    data: string;
}

/** Decodes SSE frames, joining multiple data fields with the required newline. */
export class SseEventDecoder {
    private readonly lines: SseLineDecoder;
    private readonly maxBufferChars: number;
    private readonly label: string;
    private data: string[] = [];
    private dataChars = 0;

    constructor(options: SseLineDecoderOptions) {
        this.lines = new SseLineDecoder(options);
        this.label = options.label;
        this.maxBufferChars = options.maxBufferChars ?? DEFAULT_MAX_BUFFER_CHARS;
    }

    push(chunk: Uint8Array): SseEvent[] {
        return this.consumeLines(this.lines.push(chunk));
    }

    finish(): SseEvent[] {
        const events = this.consumeLines(this.lines.finish());
        // Accept a final event without the blank line terminator. This is useful
        // for streams that close immediately after their terminal [DONE] line.
        const finalEvent = this.dispatch();
        if (finalEvent) events.push(finalEvent);
        return events;
    }

    private consumeLines(lines: string[]): SseEvent[] {
        const events: SseEvent[] = [];
        for (const line of lines) {
            if (line === '') {
                const event = this.dispatch();
                if (event) events.push(event);
                continue;
            }

            // Comments and non-data fields do not affect this chat protocol.
            const value = readSseDataLine(line);
            if (value !== null) {
                this.data.push(value);
                this.dataChars += value.length + (this.data.length > 1 ? 1 : 0);
                if (this.dataChars > this.maxBufferChars) {
                    throw new Error(`${this.label} SSE buffer overflow`);
                }
            }
        }
        return events;
    }

    private dispatch(): SseEvent | null {
        if (this.data.length === 0) return null;
        const event = { data: this.data.join('\n') };
        this.data = [];
        this.dataChars = 0;
        return event;
    }
}
