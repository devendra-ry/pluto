import { mergeMessagesSorted, type Message } from './message-helpers';

export function restoreMessagesForFailedDelete(
    current: Message[] | undefined,
    previous: Message[],
    ids: string[],
): Message[] {
    const idsToRestore = new Set(ids);
    const messagesToRestore = previous.filter((message) => idsToRestore.has(message.id));
    return mergeMessagesSorted(current ?? [], messagesToRestore);
}

export async function executeSoftDelete(
    request: () => Promise<{ error: { message: string } | null }>,
    rollback: () => void,
): Promise<void> {
    let result: { error: { message: string } | null };
    try {
        result = await request();
    } catch (error) {
        rollback();
        throw error;
    }

    if (result.error) {
        rollback();
        throw new Error(`Soft-delete failed (${result.error.message}). Apply the Supabase migrations and retry.`);
    }
}
