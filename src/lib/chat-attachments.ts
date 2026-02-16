import type { ModelConfig } from '@/lib/constants';
import type { ChatMessage } from '@/lib/types';
import { createClient } from '@/utils/supabase/server';

import {
    DEFAULT_ATTACHMENTS_BUCKET,
    MAX_ATTACHMENTS_PER_MESSAGE,
    MAX_ATTACHMENT_BYTES_FOR_MODEL,
    isImageAttachment,
    isPdfAttachment,
    isTextAttachment,
} from '@/lib/attachments';

const MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL = 12 * 1024 * 1024;
const ATTACHMENTS_BUCKET =
    process.env.SUPABASE_ATTACHMENTS_BUCKET ||
    process.env.NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET ||
    DEFAULT_ATTACHMENTS_BUCKET;

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

export async function prepareMessageAttachments(
    messages: ChatMessage[],
    supabase: ReturnType<typeof createClient>,
    userId: string,
    modelConfig: ModelConfig,
    signal?: AbortSignal
): Promise<PreparedChatMessage[]> {
    const allowImages = supportsImageInputs(modelConfig);
    const allowPdfs = supportsPdfInputs(modelConfig);
    const allowTexts = supportsTextInputs(modelConfig);
    let totalAttachmentBytes = 0;

    const prepared: PreparedChatMessage[] = [];
    for (const message of messages) {
        const attachments = message.attachments ?? [];
        if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
            throw new Error(`Too many attachments in a single message. Maximum is ${MAX_ATTACHMENTS_PER_MESSAGE}.`);
        }

        const preparedAttachments: PreparedAttachment[] = [];
        let skippedForCapabilities = 0;
        for (const attachment of attachments) {
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
            if (totalAttachmentBytes + attachment.size > MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL) {
                const maxMb = Math.floor(MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL / (1024 * 1024));
                throw new Error(`Total attachment payload is too large for one request (${maxMb}MB max).`);
            }

            const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(attachment.path);
            if (error || !data) {
                throw new Error(`Failed to load attachment: ${attachment.name}`);
            }

            const buffer = new Uint8Array(await data.arrayBuffer());
            if (buffer.byteLength > MAX_ATTACHMENT_BYTES_FOR_MODEL) {
                const maxMb = Math.floor(MAX_ATTACHMENT_BYTES_FOR_MODEL / (1024 * 1024));
                throw new Error(`Attachment "${attachment.name}" exceeds model limit (${maxMb}MB).`);
            }
            totalAttachmentBytes += buffer.byteLength;
            if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL) {
                const maxMb = Math.floor(MAX_TOTAL_ATTACHMENT_BYTES_FOR_MODEL / (1024 * 1024));
                throw new Error(`Total attachment payload is too large for one request (${maxMb}MB max).`);
            }

            const base64Data = toBase64(buffer);
            preparedAttachments.push({
                name: attachment.name,
                mimeType: attachment.mimeType,
                base64Data,
            });
        }

        prepared.push({
            role: message.role,
            content: skippedForCapabilities > 0 && !message.content
                ? '[Attachment omitted: unsupported by selected model]'
                : message.content,
            attachments: preparedAttachments,
        });

        if (skippedForCapabilities > 0) {
            console.warn(
                `[chat] skipped ${skippedForCapabilities} attachment(s) for provider=${modelConfig.provider} model without required capability`
            );
        }
    }

    return prepared;
}
