import { triggerThreadRefresh } from './thread-events';
import { mapThreadRowToThread } from './thread-model';
import type { ChatViewMessage } from '@/shared/contracts/chat';
import type { Thread } from '@/shared/contracts/thread';
import { createClient } from '@/shared/lib/supabase/client';

export async function branchThread(
    parentThreadId: string,
    messageId: string,
    _parentThread: Thread,
    _messages: ChatViewMessage[]
): Promise<Thread> {
    // Retain the existing call signature for the chat UI; persistence now comes from Postgres.
    void _parentThread;
    void _messages;
    const supabase = createClient();
    // The UI's loaded list may be only the latest history page. The database
    // validates the anchor and copies the complete persisted prefix atomically.
    const { data, error } = await supabase.rpc('branch_thread', {
        p_parent_thread_id: parentThreadId,
        p_anchor_message_id: messageId,
    });
    if (error) throw error;
    if (!data) throw new Error('The branch could not be created.');

    triggerThreadRefresh();
    return mapThreadRowToThread(data);
}
