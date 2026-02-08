import Dexie, { type EntityTable } from 'dexie';

// Thread interface - represents a chat conversation
export interface Thread {
  id: string;
  title: string;
  model: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  isPinned?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Message interface - represents a single message in a thread
export interface Message {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  createdAt: Date;
}

// Database class extending Dexie
const db = new Dexie('PlutoChat') as Dexie & {
  threads: EntityTable<Thread, 'id'>;
  messages: EntityTable<Message, 'id'>;
};

// Define schema - version 2 adds reasoning field
db.version(1).stores({
  threads: 'id, title, model, createdAt, updatedAt',
  messages: 'id, threadId, role, createdAt',
});

// Version 2: Add reasoning field (non-indexed, just stored)
db.version(2).stores({
  threads: 'id, title, model, createdAt, updatedAt',
  messages: 'id, threadId, role, createdAt',
});

// Version 3: Add reasoningEffort to threads
db.version(3).stores({
  threads: 'id, title, model, reasoningEffort, createdAt, updatedAt',
  messages: 'id, threadId, role, createdAt',
});

// Version 4: Add isPinned to threads
db.version(4).stores({
  threads: 'id, title, model, reasoningEffort, isPinned, createdAt, updatedAt',
  messages: 'id, threadId, role, createdAt',
});

export { db };
