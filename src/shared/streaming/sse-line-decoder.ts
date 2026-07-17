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
        const lines = this.drainCompleteLines();
        if (this.buffer.length > 0) {
            lines.push(this.stripCarriageReturn(this.buffer));
            this.buffer = '';
        }
        return lines;
    }

    private drainCompleteLines(): string[] {
        const lines: string[] = [];
        let lineStart = 0;
        let newlineIndex: number;
        while ((newlineIndex = this.buffer.indexOf('\n', lineStart)) !== -1) {
            lines.push(this.stripCarriageReturn(this.buffer.substring(lineStart, newlineIndex)));
            lineStart = newlineIndex + 1;
        }
        if (lineStart > 0) this.buffer = this.buffer.substring(lineStart);
        this.assertBufferBound();
        return lines;
    }

    private stripCarriageReturn(line: string) {
        return line.endsWith('\r') ? line.slice(0, -1) : line;
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
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return null;
    const value = trimmed.slice(5);
    return value.startsWith(' ') ? value.slice(1) : value;
}
