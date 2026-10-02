export const REFRESH_THREADS_EVENT = 'pluto:refresh_threads';
export const NEW_CHAT_EVENT = 'pluto:new_chat';

export function triggerThreadRefresh() {
    window.dispatchEvent(new CustomEvent(REFRESH_THREADS_EVENT));
}

export function triggerNewChat() {
    window.dispatchEvent(new CustomEvent(NEW_CHAT_EVENT));
}
