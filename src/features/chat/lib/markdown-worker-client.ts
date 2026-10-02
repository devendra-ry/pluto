import { MarkdownWorkerQueue } from './markdown-worker-queue';

export const markdownWorker = new MarkdownWorkerQueue(() =>
    new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' }));
