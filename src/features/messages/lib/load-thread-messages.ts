import type { SupabaseClient } from '@supabase/supabase-js';

import { buildAttachmentProxyUrl, DEFAULT_ATTACHMENTS_BUCKET } from '@/features/attachments';
import type { Attachment } from '@/shared/core/types';
import type { Database } from '@/shared/lib/supabase/database.types';
import {
    type Message,
    MESSAGE_SELECT_COLUMNS,
    mapMessageRowToMessage,
} from './message-helpers';

type MessageWithAttachments = {
    id: string;
    attachments?: Attachment[] | null;
};

interface CanonicalizedAttachmentUrls<TMessage> {
    messages: TMessage[];
    messagesToPersist: Array<{ id: string; attachments: Attachment[] }>;
}

function canonicalizeAttachmentUrls<TMessage extends MessageWithAttachments>(
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

const SIGNED_ATTACHMENT_URL_TTL_SECONDS = 60 * 60; // 1 hour
const SIGNED_ATTACHMENT_URL_BATCH_SIZE = 100;
const ATTACHMENTS_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET?.trim() || DEFAULT_ATTACHMENTS_BUCKET;

async function refreshAttachmentUrls(
    supabase: SupabaseClient<Database>,
    messages: Message[],
    threadId: string
) {
    const attachmentPaths = new Set<string>();
    for (const message of messages) {
        for (const attachment of message.attachments ?? []) {
            attachmentPaths.add(attachment.path);
        }
    }

    const uniquePaths = Array.from(attachmentPaths);
    if (uniquePaths.length === 0) {
        return messages;
    }

    const signedUrlByPath = new Map<string, string>();
    for (let i = 0; i < uniquePaths.length; i += SIGNED_ATTACHMENT_URL_BATCH_SIZE) {
        const batchPaths = uniquePaths.slice(i, i + SIGNED_ATTACHMENT_URL_BATCH_SIZE);
        if (batchPaths.length === 0) continue;

        const { data, error } = await supabase.storage
            .from(ATTACHMENTS_BUCKET)
            .createSignedUrls(batchPaths, SIGNED_ATTACHMENT_URL_TTL_SECONDS);

        if (error || !data) {
            if (process.env.NODE_ENV !== 'production') {
                console.warn('[messages] Failed to refresh signed attachment URLs', error);
            }
            continue;
        }

        for (const entry of data) {
            if (!entry || typeof entry.path !== 'string' || typeof entry.signedUrl !== 'string' || !entry.signedUrl) {
                continue;
            }
            signedUrlByPath.set(entry.path, entry.signedUrl);
        }
    }

    const { messages: refreshedMessages, messagesToPersist } = canonicalizeAttachmentUrls(
        messages,
        threadId,
        signedUrlByPath,
    );

    if (messagesToPersist.length > 0) {
        void Promise.all(
            messagesToPersist.map(async ({ id, attachments }) => {
                const { error } = await supabase
                    .from('messages')
                    .update({ attachments: attachments as Database['public']['Tables']['messages']['Row']['attachments'] })
                    .eq('id', id);

                if (error && process.env.NODE_ENV !== 'production') {
                    console.warn('[messages] Failed to persist canonical attachment URL', {
                        messageId: id,
                        error: error.message,
                    });
                }
            })
        );
    }

    return refreshedMessages;
}

/**
 * Loads the canonical message history for a thread, including refreshed
 * signed attachment URLs. Safe to call from both server and client — the
 * Supabase client is injected by the caller.
 */
export async function loadThreadMessages(
    supabase: SupabaseClient<Database>,
    threadId: string
): Promise<Message[]> {
    const { data, error } = await supabase
        .from('messages')
        .select(MESSAGE_SELECT_COLUMNS)
        .eq('thread_id', threadId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

    if (error) throw error;
    const messages = (data ?? []).map(mapMessageRowToMessage);
    return refreshAttachmentUrls(supabase, messages, threadId);
}
