export const MESSAGE_QUERY_KEY_PREFIX = 'messages';

export function getMessagesQueryKey(threadId: string) {
    return [MESSAGE_QUERY_KEY_PREFIX, threadId] as const;
}
