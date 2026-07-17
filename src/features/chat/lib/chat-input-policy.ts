import {
    isImageAttachment,
    isPdfAttachment,
    isSupportedAttachmentMimeType,
    isTextAttachment,
} from '@/features/attachments/lib/attachments';
import type { ChatSubmitMode } from '../components/chat-input/chat-input-types';

export interface AttachmentCapabilities {
    images: boolean;
    pdfs: boolean;
    texts: boolean;
}

export function validateChatSubmission(mode: ChatSubmitMode, prompt: string, attachmentCount: number): string | null {
    if (mode === 'image-edit' && attachmentCount === 0) return 'Attach at least one image for Image Edit mode';
    if (mode === 'image-edit' && !prompt.trim()) return 'Enter an edit prompt for Image Edit mode';
    if (mode === 'video' && attachmentCount === 0) return 'Attach an image for Image to Video mode';
    if (mode === 'video' && !prompt.trim()) return 'Enter an animation prompt for Image to Video mode';
    return null;
}

export function isFileAllowedForChatInput(
    mimeType: string,
    imageOnlyMode: boolean,
    capabilities: AttachmentCapabilities,
): boolean {
    if (!isSupportedAttachmentMimeType(mimeType)) return false;
    if (imageOnlyMode) return isImageAttachment(mimeType);
    return (
        (isImageAttachment(mimeType) && capabilities.images)
        || (isPdfAttachment(mimeType) && capabilities.pdfs)
        || (isTextAttachment(mimeType) && capabilities.texts)
    );
}
