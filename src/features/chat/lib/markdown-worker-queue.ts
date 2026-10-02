import type { Root } from 'hast';
import type { MarkdownParseRequest, MarkdownParseResponse } from './markdown-worker-protocol';

export interface MarkdownWorkerTransport {
    onmessage: ((event: MessageEvent<MarkdownParseResponse>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: ((event: MessageEvent) => void) | null;
    postMessage: (message: MarkdownParseRequest) => void;
    terminate: () => void;
}
interface Task {
    request: MarkdownParseRequest;
    resolve: (tree: Root) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
}

/** One active parse; aborted revisions are removed before reaching the worker. */
export class MarkdownWorkerQueue {
    private worker: MarkdownWorkerTransport | null = null;
    private pending: Task[] = [];
    private active: Task | null = null;
    private sequence = 0;
    private failed = false;
    private ready = false;
    private timeout: ReturnType<typeof setTimeout> | null = null;
    private idle: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly createWorker: () => MarkdownWorkerTransport,
        private readonly timeoutMs = 15_000, private readonly idleMs = 30_000) {}

    parse(content: string, isStreaming: boolean, signal: AbortSignal): Promise<Root> {
        if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
        if (this.failed) return Promise.reject(new Error('Markdown worker unavailable'));
        return new Promise((resolve, reject) => {
            const task: Task = {
                request: { id: ++this.sequence, content, isStreaming }, resolve, reject,
                cleanup: () => signal.removeEventListener('abort', abort),
            };
            const abort = () => {
                this.pending = this.pending.filter(item => item !== task);
                // An active parse must finish before another is posted. Its promise
                // is cancelled immediately and its eventual result is ignored.
                task.reject(new DOMException('Cancelled', 'AbortError'));
                task.cleanup();
                // Nothing was posted while the worker was starting. Promote
                // the latest queued revision without parsing obsolete source.
                if (this.active === task && !this.ready) {
                    this.active = null;
                    if (this.timeout) clearTimeout(this.timeout);
                    this.timeout = null;
                    this.pump();
                }
            };
            signal.addEventListener('abort', abort, { once: true });
            this.pending.push(task);
            this.pump();
        });
    }

    private pump() {
        if (this.active || this.failed) return;
        if (this.idle) { clearTimeout(this.idle); this.idle = null; }
        const task = this.pending.shift();
        if (!task) {
            if (this.worker) this.idle = setTimeout(() => {
                this.worker?.terminate(); this.worker = null; this.ready = false; this.idle = null;
            }, this.idleMs);
            return;
        }
        this.active = task;
        try {
            if (!this.worker) {
                this.worker = this.createWorker();
                this.worker.onmessage = ({ data }) => {
                    if ('type' in data) {
                        if (!this.ready) {
                            this.ready = true;
                            try { if (this.active) this.worker?.postMessage(this.active.request); }
                            catch { this.disable(); }
                        }
                        return;
                    }
                    const current = this.active;
                    if (!current || current.request.id !== data.id) return;
                    if (this.timeout) clearTimeout(this.timeout);
                    this.timeout = null;
                    this.active = null;
                    current.cleanup();
                    if ('error' in data) current.reject(new Error(data.error));
                    else current.resolve(data.tree);
                    this.pump();
                };
                this.worker.onerror = this.worker.onmessageerror = () => this.disable();
            }
            this.timeout = setTimeout(() => this.disable(), this.timeoutMs);
            // Turbopack initializes the entry asynchronously. Wait for the
            // handler's handshake rather than losing the first request.
            if (this.ready) this.worker.postMessage(task.request);
        } catch { this.disable(); }
    }

    private disable() {
        this.failed = true;
        this.dispose();
    }

    dispose() {
        if (this.timeout) clearTimeout(this.timeout);
        if (this.idle) clearTimeout(this.idle);
        this.timeout = this.idle = null;
        this.worker?.terminate(); this.worker = null; this.ready = false;
        const tasks = [...(this.active ? [this.active] : []), ...this.pending];
        this.active = null; this.pending = [];
        for (const task of tasks) {
            task.cleanup(); task.reject(new Error('Markdown worker unavailable'));
        }
    }
}
