'use client';

import { type Attachment } from '@/shared/core/types';
import { createIdempotencyKey } from '@/shared/lib/idempotency';

function extractErrorMessage(payload: unknown, fallback: string) {
    if (!payload || typeof payload !== 'object') return fallback;
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (typeof error === 'string' && error.trim()) return error;
    const message = record.message;
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
    const idempotencyKey = createIdempotencyKey('upload-cleanup');
    const response = await fetch('/api/uploads', {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': idempotencyKey,
        },
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
    } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[uploads] Failed to parse cleanup response payload', error);
        }
        payload = null;
    }

    throw new Error(extractErrorMessage(payload, 'Failed to cleanup attachments'));
}

export function startUploadFileForThread(
    threadId: string,
    file: File,
    onProgress?: (progress: number) => void
): UploadTask {
    let cancelUpload = () => {};

    const promise = new Promise<Attachment>((resolve, reject) => {
        let settled = false;
        let uploadXhr: XMLHttpRequest | null = null;

        const resolveOnce = (attachment: Attachment) => {
            if (settled) return;
            settled = true;
            resolve(attachment);
        };

        const rejectOnce = (error: Error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };

        const failCanceled = () => {
            rejectOnce(new Error(`Upload canceled for "${file.name}"`));
        };

        onProgress?.(1);
        const uploadBody = new FormData();
        uploadBody.append('threadId', threadId);
        uploadBody.append('file', file);

        uploadXhr = new XMLHttpRequest();
        uploadXhr.open('POST', '/api/uploads');
        uploadXhr.responseType = 'json';
        uploadXhr.setRequestHeader(
            'X-Idempotency-Key',
            `${createIdempotencyKey('upload')}-${threadId}-${file.size}-${file.lastModified}`
        );

        uploadXhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || !onProgress) return;
            const progress = Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100)));
            onProgress(progress);
        };

        uploadXhr.onerror = () => {
            rejectOnce(new Error(`Failed to upload "${file.name}"`));
        };

        uploadXhr.onabort = () => {
            failCanceled();
        };

        uploadXhr.onload = () => {
            const payload = uploadXhr?.response as {
                attachment?: Attachment;
                error?: string;
                message?: string;
            } | null;
            if (!uploadXhr || uploadXhr.status < 200 || uploadXhr.status >= 300) {
                const fallback = `Failed to upload "${file.name}"`;
                rejectOnce(new Error(extractErrorMessage(payload, fallback)));
                return;
            }
            if (!payload?.attachment) {
                rejectOnce(new Error(`Upload returned an invalid payload for "${file.name}"`));
                return;
            }

            onProgress?.(100);
            resolveOnce(payload.attachment);
        };

        uploadXhr.send(uploadBody);

        cancelUpload = () => {
            if (settled) return;
            if (uploadXhr && uploadXhr.readyState !== XMLHttpRequest.DONE) {
                uploadXhr.abort();
            }
        };
    });

    return {
        promise,
        cancel: () => cancelUpload(),
    };
}
