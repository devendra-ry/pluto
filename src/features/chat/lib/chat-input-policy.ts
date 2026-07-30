import {
    isImageAttachment,
    isPdfAttachment,
    isSupportedAttachmentMimeType,
    isTextAttachment,
} from '@/features/attachments';

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
