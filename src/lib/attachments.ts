export const DEFAULT_ATTACHMENTS_BUCKET = 'chat-attachments';
export const MAX_ATTACHMENTS_PER_MESSAGE = 6;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_ATTACHMENT_BYTES_FOR_MODEL = 10 * 1024 * 1024; // 10MB

export const SUPPORTED_ATTACHMENT_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/pdf',
] as const;

export function isImageAttachment(mimeType: string) {
    return mimeType.startsWith('image/');
}

export function isPdfAttachment(mimeType: string) {
    return mimeType === 'application/pdf';
}

export function isSupportedAttachmentMimeType(mimeType: string) {
    return SUPPORTED_ATTACHMENT_MIME_TYPES.includes(
        mimeType as typeof SUPPORTED_ATTACHMENT_MIME_TYPES[number]
    );
}
