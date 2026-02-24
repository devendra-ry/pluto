export function scheduleFrame(callback: () => void): void {
    if (typeof globalThis.requestAnimationFrame === 'function') {
        globalThis.requestAnimationFrame(callback);
        return;
    }

    globalThis.setTimeout(callback, 16);
}
