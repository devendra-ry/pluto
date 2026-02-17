'use client';

import { type Attachment } from '@/lib/types';

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
        let canceled = false;
        const initAbortController = new AbortController();
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

        void (async () => {
            const initResponse = await fetch('/api/uploads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    threadId,
                    fileName: file.name,
                    mimeType: file.type || 'application/octet-stream',
                    size: file.size,
                }),
                signal: initAbortController.signal,
            });

            let initPayload: unknown = null;
            try {
                initPayload = await initResponse.json();
            } catch (error) {
                if (process.env.NODE_ENV !== 'production') {
                    console.warn('[uploads] Failed to parse signed upload init response payload', error);
                }
                initPayload = null;
            }

            if (!initResponse.ok) {
                const fallback = `Failed to upload "${file.name}"`;
                rejectOnce(new Error(extractErrorMessage(initPayload, fallback)));
                return;
            }

            const payload = initPayload as {
                upload?: { signedUrl?: string };
                attachment?: Attachment;
            } | null;

            if (!payload?.upload?.signedUrl || !payload.attachment) {
                rejectOnce(new Error(`Upload returned an invalid payload for "${file.name}"`));
                return;
            }
            const attachment = payload.attachment;
            const signedUrl = payload.upload.signedUrl;

            if (canceled || initAbortController.signal.aborted) {
                failCanceled();
                return;
            }

            onProgress?.(1);

            const uploadBody = new FormData();
            uploadBody.append('cacheControl', '3600');
            uploadBody.append('', file);

            uploadXhr = new XMLHttpRequest();
            uploadXhr.open('PUT', signedUrl);
            uploadXhr.responseType = 'json';

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
                const uploadPayload = uploadXhr?.response as { error?: string; message?: string } | null;
                if (!uploadXhr || uploadXhr.status < 200 || uploadXhr.status >= 300) {
                    const fallback = `Failed to upload "${file.name}"`;
                    rejectOnce(new Error(extractErrorMessage(uploadPayload, fallback)));
                    return;
                }

                onProgress?.(100);
                resolveOnce(attachment);
            };

            uploadXhr.send(uploadBody);
        })().catch((error) => {
            if (error instanceof DOMException && error.name === 'AbortError') {
                failCanceled();
                return;
            }
            const fallback = error instanceof Error ? error.message : `Failed to upload "${file.name}"`;
            rejectOnce(new Error(fallback));
        });

        cancelUpload = () => {
            if (settled) return;
            canceled = true;
            initAbortController.abort();
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
