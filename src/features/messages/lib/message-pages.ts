import type { InfiniteData } from '@tanstack/react-query';
import type { MessageCursor, MessagePage } from './load-thread-messages';
import { mergeMessagesSorted, type Message } from './message-helpers';

export type MessagePages = InfiniteData<MessagePage, MessageCursor | null>;
export function flattenMessagePages(data: MessagePages | undefined): Message[] {
    if (!data) return [];
    const populated = data.pages.filter(page => page.messages.length > 0);
    // The loader and mutation helper already keep a single window ordered.
    // Avoid sorting/allocating it again for each realtime update.
    if (populated.length === 1) return populated[0]!.messages;
    return mergeMessagesSorted([], [...populated].reverse().flatMap(page => page.messages));
}
// Preserve pagination boundaries when optimistic/realtime edits update rows.
export function updateMessagePages(data: MessagePages | undefined, update: (messages: Message[]) => Message[]): MessagePages | undefined {
    if (!data?.pages.length) return data;
    const previous = flattenMessagePages(data);
    const messages = update(previous);
    if (messages === previous) return data;
    return { ...data, pages: data.pages.map((page, index) => ({ ...page, messages: index === 0 ? messages : [] })) };
}
