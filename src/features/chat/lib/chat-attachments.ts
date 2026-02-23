import type { ModelConfig } from '@/shared/core/constants';
import type { ChatMessage } from '@/shared/core/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/utils/supabase/database.types';
import { getAttachmentsBucketName, AttachmentCache } from '@/features/attachments/server';

import {
    MAX_ATTACHMENTS_PER_MESSAGE,
    MAX_ATTACHMENT_BYTES_FOR_MODEL,
    isImageAttachment,
    isPdfAttachment,
    isTextAttachment,
} from '@/features/attachments';

const MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL = MAX_ATTACHMENTS_PER_MESSAGE * MAX_ATTACHMENT_BYTES_FOR_MODEL;
const ATTACHMENT_DOWNLOAD_CONCURRENCY = 4;
const ATTACHMENTS_BUCKET = getAttachmentsBucketName();

// In-memory cache for downloaded attachments
interface CachedAttachment {
    attachment: PreparedAttachment;
    byteLength: number;
}

const attachmentCache = new AttachmentCache<CachedAttachment>();

export interface PreparedAttachment {
    name: string;
    mimeType: string;
    base64Data: string;
}

export interface PreparedChatMessage {
    role: 'user' | 'assistant';
    content: string;
    attachments: PreparedAttachment[];
}

function supportsImageInputs(modelConfig: ModelConfig) {
    return modelConfig.provider !== 'openrouter' && modelConfig.capabilities.includes('vision');
}

function supportsPdfInputs(modelConfig: ModelConfig) {
    return modelConfig.provider !== 'openrouter'
        && (modelConfig.capabilities.includes('pdf') || modelConfig.provider === 'google');
}

function supportsTextInputs(modelConfig: ModelConfig) {
    return modelConfig.provider === 'google';
}

function toBase64(bytes: Uint8Array) {
    return Buffer.from(bytes).toString('base64');
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const current = nextIndex;
            nextIndex += 1;
            if (current >= items.length) {
                return;
            }
            results[current] = await mapper(items[current], current);
        }
    }

    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

export async function prepareMessageAttachments(
    messages: ChatMessage[],
    supabase: SupabaseClient<Database>,
    userId: string,
    modelConfig: ModelConfig,
    signal?: AbortSignal
): Promise<PreparedChatMessage[]> {
    const allowImages = supportsImageInputs(modelConfig);
    const allowPdfs = supportsPdfInputs(modelConfig);
    const allowTexts = supportsTextInputs(modelConfig);
    let declaredTotalAttachmentBytes = 0;

    interface DownloadTask {
        messageIndex: number;
        attachmentIndex: number;
        attachment: NonNullable<ChatMessage['attachments']>[number];
    }
    const downloadTasks: DownloadTask[] = [];

    const prepared: PreparedChatMessage[] = [];
    for (const [messageIndex, message] of messages.entries()) {
        const attachments = message.attachments ?? [];
        if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
            throw new Error(`Too many attachments in a single message. Maximum is ${MAX_ATTACHMENTS_PER_MESSAGE}.`);
        }

        let skippedForCapabilities = 0;
        for (const [attachmentIndex, attachment] of attachments.entries()) {
            if (signal?.aborted) throw new Error('Request aborted');

            if (!attachment.path.startsWith(`${userId}/`)) {
                throw new Error('Invalid attachment path');
            }

            const imageAttachment = isImageAttachment(attachment.mimeType);
            const pdfAttachment = isPdfAttachment(attachment.mimeType);
            const textAttachment = isTextAttachment(attachment.mimeType);

            if (!imageAttachment && !pdfAttachment && !textAttachment) {
                throw new Error(`Unsupported attachment type: ${attachment.mimeType}`);
            }
            if (imageAttachment && !allowImages) {
                skippedForCapabilities += 1;
                continue;
            }
            if (pdfAttachment && !allowPdfs) {
                skippedForCapabilities += 1;
                continue;
            }
            if (textAttachment && !allowTexts) {
                skippedForCapabilities += 1;
                continue;
            }

            if (attachment.size > MAX_ATTACHMENT_BYTES_FOR_MODEL) {
                const maxMb = Math.floor(MAX_ATTACHMENT_BYTES_FOR_MODEL / (1024 * 1024));
                throw new Error(`Attachment "${attachment.name}" exceeds model limit (${maxMb}MB).`);
            }
            if (declaredTotalAttachmentBytes + attachment.size > MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL) {
                const maxMb = Math.floor(MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL / (1024 * 1024));
                throw new Error(`Total attachment payload is too large for one request (${maxMb}MB max).`);
            }
            declaredTotalAttachmentBytes += attachment.size;

            downloadTasks.push({
                messageIndex,
                attachmentIndex,
                attachment,
            });
        }

        prepared.push({
            role: message.role,
            content: skippedForCapabilities > 0 && !message.content
                ? '[Attachment omitted: unsupported by selected model]'
                : message.content,
            attachments: [],
        });

        if (skippedForCapabilities > 0) {
            console.warn(
                `[chat] skipped ${skippedForCapabilities} attachment(s) for provider=${modelConfig.provider} model without required capability`
            );
        }
    }

    const downloadedAttachments = await mapWithConcurrency(
        downloadTasks,
        ATTACHMENT_DOWNLOAD_CONCURRENCY,
        async (task) => {
            if (signal?.aborted) throw new Error('Request aborted');

            // Use path as cache key. Since we validate path starts with userId/ below,
            // this effectively scopes the cache to the user, preventing RLS bypass.
            const cached = attachmentCache.get(task.attachment.path);
            if (cached) {
                return {
                    messageIndex: task.messageIndex,
                    attachmentIndex: task.attachmentIndex,
                    byteLength: cached.byteLength,
                    attachment: cached.attachment,
                };
            }

            const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(task.attachment.path);
            if (error || !data) {
                throw new Error(`Failed to load attachment: ${task.attachment.name}`);
            }

            const buffer = new Uint8Array(await data.arrayBuffer());
            if (buffer.byteLength > MAX_ATTACHMENT_BYTES_FOR_MODEL) {
                const maxMb = Math.floor(MAX_ATTACHMENT_BYTES_FOR_MODEL / (1024 * 1024));
                throw new Error(`Attachment "${task.attachment.name}" exceeds model limit (${maxMb}MB).`);
            }

            const preparedAttachment: PreparedAttachment = {
                name: task.attachment.name,
                mimeType: task.attachment.mimeType,
                base64Data: toBase64(buffer),
            };

            attachmentCache.set(task.attachment.path, {
                attachment: preparedAttachment,
                byteLength: buffer.byteLength,
            });

            return {
                messageIndex: task.messageIndex,
                attachmentIndex: task.attachmentIndex,
                byteLength: buffer.byteLength,
                attachment: preparedAttachment,
            };
        }
    );

    let totalAttachmentBytes = 0;
    const attachmentsByMessage = new Map<number, Array<{
        attachmentIndex: number;
        attachment: PreparedAttachment;
    }>>();
    for (const downloaded of downloadedAttachments) {
        totalAttachmentBytes += downloaded.byteLength;
        if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL) {
            const maxMb = Math.floor(MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL / (1024 * 1024));
            throw new Error(`Total attachment payload is too large for one request (${maxMb}MB max).`);
        }

        const list = attachmentsByMessage.get(downloaded.messageIndex) ?? [];
        list.push({
            attachmentIndex: downloaded.attachmentIndex,
            attachment: downloaded.attachment,
        });
        attachmentsByMessage.set(downloaded.messageIndex, list);
    }

    for (const [messageIndex, entry] of attachmentsByMessage.entries()) {
        entry.sort((a, b) => a.attachmentIndex - b.attachmentIndex);
        prepared[messageIndex].attachments = entry.map((item) => item.attachment);
    }

    return prepared;
}

