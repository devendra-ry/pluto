import {
    MAX_ATTACHMENTS_PER_MESSAGE,
    MAX_ATTACHMENT_SIZE_BYTES,
    MAX_TOTAL_ATTACHMENT_BYTES,
    isImageAttachment,
    isPdfAttachment,
    isSupportedAttachmentMimeType,
    isTextAttachment,
} from '@/features/attachments';

type ChatInputFileRejectionReason = 'count' | 'individual-size' | 'total-size';

export interface ChatInputFileSelection {
    accepted: File[];
    rejected: Array<{ file: File; reason: ChatInputFileRejectionReason }>;
    acceptedBytes: number;
}

/** Select files in order while charging only files that will actually be added. */
export function selectChatInputFiles(
    files: readonly File[],
    options: {
        currentCount?: number;
        currentBytes?: number;
        maxCount?: number;
        maxFileBytes?: number;
        maxTotalBytes?: number;
    } = {},
): ChatInputFileSelection {
    const maxCount = options.maxCount ?? MAX_ATTACHMENTS_PER_MESSAGE;
    const maxFileBytes = options.maxFileBytes ?? MAX_ATTACHMENT_SIZE_BYTES;
    const maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_ATTACHMENT_BYTES;
    let count = Math.max(0, options.currentCount ?? 0);
    let bytes = Math.max(0, options.currentBytes ?? 0);
    const accepted: File[] = [];
    const rejected: ChatInputFileSelection['rejected'] = [];

    for (const file of files) {
        if (count >= maxCount) {
            rejected.push({ file, reason: 'count' });
            continue;
        }
        if (file.size > maxFileBytes) {
            rejected.push({ file, reason: 'individual-size' });
            continue;
        }
        if (bytes + file.size > maxTotalBytes) {
            rejected.push({ file, reason: 'total-size' });
            continue;
        }
        accepted.push(file);
        count += 1;
        bytes += file.size;
    }

    return { accepted, rejected, acceptedBytes: bytes - Math.max(0, options.currentBytes ?? 0) };
}

export interface AttachmentCapabilities {
    images: boolean;
    pdfs: boolean;
    texts: boolean;
}

export function isFileAllowedForChatInput(
    mimeType: string,
    capabilities: AttachmentCapabilities,
): boolean {
    if (!isSupportedAttachmentMimeType(mimeType)) return false;
    return (
        (isImageAttachment(mimeType) && capabilities.images)
        || (isPdfAttachment(mimeType) && capabilities.pdfs)
        || (isTextAttachment(mimeType) && capabilities.texts)
    );
}
