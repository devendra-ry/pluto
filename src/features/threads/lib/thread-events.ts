export const REFRESH_THREADS_EVENT = 'pluto:refresh_threads';

export function triggerThreadRefresh() {
    window.dispatchEvent(new CustomEvent(REFRESH_THREADS_EVENT));
}
