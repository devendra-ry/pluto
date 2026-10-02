import { parseMarkdown } from './markdown-parser';
import type { MarkdownParseRequest, MarkdownParseResponse } from './markdown-worker-protocol';

// Use a narrow worker interface without adding WebWorker globals to the DOM app.
const scope = globalThis as unknown as {
    onmessage: (event: MessageEvent<MarkdownParseRequest>) => void;
    postMessage: (message: MarkdownParseResponse) => void;
};
scope.onmessage = ({ data }) => {
    try {
        const started = performance.now();
        const tree = parseMarkdown(data.content, data.isStreaming);
        scope.postMessage({ id: data.id, tree, parseMs: performance.now() - started });
    } catch {
        scope.postMessage({ id: data.id, error: 'Unable to format Markdown.' });
    }
};
scope.postMessage({ type: 'ready' });
