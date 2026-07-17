import { buildAttachmentProxyUrl } from '@/features/attachments';
import type { Attachment } from '@/shared/core/types';

type MessageWithAttachments = {
    id: string;
    attachments?: Attachment[] | null;
};

export interface CanonicalizedAttachmentUrls<TMessage> {
    messages: TMessage[];
    messagesToPersist: Array<{ id: string; attachments: Attachment[] }>;
}

export function canonicalizeAttachmentUrls<TMessage extends MessageWithAttachments>(
    messages: TMessage[],
    threadId: string,
    signedUrlByPath: ReadonlyMap<string, string>,
): CanonicalizedAttachmentUrls<TMessage> {
    const messagesToPersist: Array<{ id: string; attachments: Attachment[] }> = [];
    const refreshedMessages = messages.map((message) => {
        const currentAttachments = message.attachments ?? [];
        if (currentAttachments.length === 0) return message;

        let persistedUrlChanged = false;
        const canonicalAttachments = currentAttachments.map((attachment) => {
            const canonicalUrl = buildAttachmentProxyUrl(threadId, attachment.path);
            if (attachment.url !== canonicalUrl) persistedUrlChanged = true;
            return { ...attachment, url: canonicalUrl };
        });
        const displayAttachments = canonicalAttachments.map((attachment) => {
            const signedUrl = signedUrlByPath.get(attachment.path);
            return signedUrl ? { ...attachment, url: signedUrl } : attachment;
        });

        if (persistedUrlChanged) {
            messagesToPersist.push({ id: message.id, attachments: canonicalAttachments });
        }
        return { ...message, attachments: displayAttachments };
    });

    return { messages: refreshedMessages, messagesToPersist };
}
