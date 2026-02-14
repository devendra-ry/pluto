'use client';

import { type Attachment } from '@/lib/types';

function extractErrorMessage(payload: unknown, fallback: string) {
    if (!payload || typeof payload !== 'object') return fallback;
    const record = payload as Record<string, unknown>;
    const message = record.error;
    if (typeof message === 'string' && message.trim()) return message;
    return fallback;
}

export async function uploadFileForThread(
    threadId: string,
    file: File,
    onProgress?: (progress: number) => void
): Promise<Attachment> {
    return startUploadFileForThread(threadId, file, onProgress).promise;
}

export interface UploadTask {
    promise: Promise<Attachment>;
    cancel: () => void;
}

export async function cleanupThreadAttachments(
    threadId: string,
    paths?: string[]
): Promise<void> {
    const response = await fetch('/api/uploads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            threadId,
            paths: paths && paths.length > 0 ? paths : undefined,
        }),
    });

    if (response.ok) {
        return;
    }

    let payload: unknown = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    throw new Error(extractErrorMessage(payload, 'Failed to cleanup attachments'));
}

export function startUploadFileForThread(
    threadId: string,
    file: File,
    onProgress?: (progress: number) => void
): UploadTask {
    const formData = new FormData();
    formData.append('threadId', threadId);
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');
    xhr.responseType = 'json';

    const promise = new Promise<Attachment>((resolve, reject) => {
        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || !onProgress) return;
            const progress = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
            onProgress(progress);
        };

        xhr.onerror = () => {
            reject(new Error(`Failed to upload "${file.name}"`));
        };

        xhr.onabort = () => {
            reject(new Error(`Upload canceled for "${file.name}"`));
        };

        xhr.onload = () => {
            const payload = xhr.response as { attachment?: Attachment; error?: string } | null;
            if (xhr.status < 200 || xhr.status >= 300) {
                const fallback = `Failed to upload "${file.name}"`;
                reject(new Error(extractErrorMessage(payload, fallback)));
                return;
            }

            if (!payload?.attachment) {
                reject(new Error(`Upload returned an invalid payload for "${file.name}"`));
                return;
            }

            onProgress?.(100);
            resolve(payload.attachment);
        };

        xhr.send(formData);
    });

    return {
        promise,
        cancel: () => {
            if (xhr.readyState !== XMLHttpRequest.DONE) {
                xhr.abort();
            }
        },
    };
}
