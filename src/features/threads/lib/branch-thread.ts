import {
    buildBranchMessageRows,
    buildBranchTitle,
    selectMessagesThroughBranch,
} from '@/features/threads/lib/branch-plan';
import { triggerThreadRefresh } from '@/features/threads/lib/thread-events';
import { mapThreadRowToThread } from '@/features/threads/lib/thread-model';
import type { ChatViewMessage } from '@/shared/contracts/chat';
import type { Thread } from '@/shared/contracts/thread';
import { createClient } from '@/utils/supabase/client';

export async function branchThread(
    parentThreadId: string,
    messageId: string,
    parentThread: Thread,
    messages: ChatViewMessage[]
): Promise<Thread> {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) throw new Error('You must be signed in to branch a chat.');

    const messagesToCopy = selectMessagesThroughBranch(messages, messageId);
    const { data: sourceRows, error: sourceError } = await supabase
        .from('messages')
        .select('id, created_at')
        .eq('thread_id', parentThreadId)
        .in('id', messagesToCopy.map((message) => message.id));
    if (sourceError) throw sourceError;

    const { data: newThreadRow, error: threadError } = await supabase
        .from('threads')
        .insert({
            title: buildBranchTitle(parentThread.title),
            model: parentThread.model,
            reasoning_effort: parentThread.reasoning_effort ?? null,
            system_prompt: parentThread.system_prompt ?? null,
            user_id: user.id,
        })
        .select()
        .single();
    if (threadError) throw threadError;

    const newThread = mapThreadRowToThread(newThreadRow);
    const createdAtById = new Map((sourceRows ?? []).map((row) => [row.id, row.created_at]));
    const messageRows = buildBranchMessageRows(
        messagesToCopy,
        newThread.id,
        user.id,
        createdAtById,
        new Date().toISOString(),
    );
    const { error: messageError } = await supabase.from('messages').insert(messageRows);
    if (messageError) {
        await supabase.from('threads').delete().eq('id', newThread.id);
        throw messageError;
    }

    triggerThreadRefresh();
    return newThread;
}
