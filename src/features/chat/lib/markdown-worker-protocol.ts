import type { Root } from 'hast';

export interface MarkdownParseRequest {
    id: number;
    content: string;
    isStreaming: boolean;
}

export type MarkdownParseResponse =
    | { type: 'ready' }
    | { id: number; tree: Root; parseMs: number }
    | { id: number; error: string };
