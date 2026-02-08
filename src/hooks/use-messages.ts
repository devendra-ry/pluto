'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Message } from '@/lib/db';
import { nanoid } from 'nanoid';

// Get all messages for a thread
export function useMessages(threadId: string | null) {
    const messages = useLiveQuery(
        () =>
            threadId
                ? db.messages.where('threadId').equals(threadId).sortBy('createdAt')
                : [],
        [threadId]
    );
    return messages ?? [];
}

// Add a new message to a thread
export async function addMessage(
    threadId: string,
    role: 'user' | 'assistant',
    content: string,
    reasoning?: string
): Promise<Message> {
    const message: Message = {
        id: nanoid(),
        threadId,
        role,
        content,
        reasoning,
        createdAt: new Date(),
    };
    await db.messages.add(message);
    return message;
}

// Update message content (for streaming updates)
export async function updateMessage(id: string, content: string, reasoning?: string) {
    await db.messages.update(id, { content, reasoning });
}

// Delete a message
export async function deleteMessage(id: string) {
    await db.messages.delete(id);
}

// Clear all messages in a thread
export async function clearThreadMessages(threadId: string) {
    await db.messages.where('threadId').equals(threadId).delete();
}
