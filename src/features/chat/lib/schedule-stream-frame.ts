/** Keep streaming responsive when animation frames are suspended in a hidden tab. */
export function scheduleStreamFrame(callback: () => void): () => void {
    let pending = true;
    let frame: number | undefined;
    const cancel = () => {
        pending = false;
        if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
        clearTimeout(timeout);
    };
    const flush = () => {
        if (!pending) return;
        cancel();
        callback();
    };
    // Always arm the fallback: the tab can become hidden after scheduling rAF.
    const timeout = setTimeout(flush, 50);
    if (typeof globalThis.requestAnimationFrame === 'function') frame = globalThis.requestAnimationFrame(flush);
    return cancel;
}
