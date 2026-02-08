'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Thread } from '@/lib/db';
import { nanoid } from 'nanoid';

// Get all threads sorted by most recent
export function useThreads() {
    const threads = useLiveQuery(
        () => db.threads.orderBy('updatedAt').reverse().toArray(),
        []
    );
    return threads ?? [];
}

// Get a single thread by ID
export function useThread(id: string | null) {
    return useLiveQuery(
        () => (id ? db.threads.get(id) : undefined),
        [id]
    );
}

// Create a new thread
export async function createThread(model: string): Promise<Thread> {
    const now = new Date();
    const thread: Thread = {
        id: nanoid(),
        title: 'New Chat',
        model,
        createdAt: now,
        updatedAt: now,
    };
    await db.threads.add(thread);
    return thread;
}

// Update thread title
export async function updateThreadTitle(id: string, title: string) {
    await db.threads.update(id, { title, updatedAt: new Date() });
}

// Update thread model
export async function updateThreadModel(id: string, model: string) {
    await db.threads.update(id, { model, updatedAt: new Date() });
}

// Update thread timestamp (for sorting)
export async function touchThread(id: string) {
    await db.threads.update(id, { updatedAt: new Date() });
}

// Delete a thread and all its messages
export async function deleteThread(id: string) {
    await db.transaction('rw', [db.threads, db.messages], async () => {
        await db.messages.where('threadId').equals(id).delete();
        await db.threads.delete(id);
    });
}
