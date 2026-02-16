export type ScheduledFrame =
    | { kind: 'raf'; id: number }
    | { kind: 'timeout'; id: ReturnType<typeof globalThis.setTimeout> };

export function scheduleFrame(callback: () => void): ScheduledFrame {
    if (typeof globalThis.requestAnimationFrame === 'function') {
        return {
            kind: 'raf',
            id: globalThis.requestAnimationFrame(callback),
        };
    }

    return {
        kind: 'timeout',
        id: globalThis.setTimeout(callback, 16),
    };
}

export function cancelScheduledFrame(frame: ScheduledFrame | null) {
    if (!frame) return;

    if (frame.kind === 'raf' && typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(frame.id);
        return;
    }

    globalThis.clearTimeout(frame.id);
}
