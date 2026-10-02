'use client';

import { useEffect } from 'react';

/** Durable jobs resume on sign-in, reconnect, and while a visible session runs. */
export function useThreadCleanup(userId: string | null) {
    useEffect(() => {
        if (!userId) return;
        let disposed = false;
        let running = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();
        const schedule = (delay = 30_000) => {
            clearTimeout(timer);
            if (!disposed) timer = setTimeout(() => { void run(); }, delay);
        };
        const run = async () => {
            if (disposed || running) return;
            if (!navigator.onLine || document.visibilityState === 'hidden') { schedule(); return; }
            running = true;
            let delay = 30_000;
            try {
                const response = await fetch('/api/thread-cleanup', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: '{}', signal: controller.signal,
                });
                if (response.status === 401) return;
                if (!response.ok) { delay = 60_000; return; }
                const result = await response.json() as { claimed?: number };
                if ((result.claimed ?? 0) >= 5) delay = 1_000;
            } catch { delay = 60_000; }
            finally { running = false; schedule(delay); }
        };
        const onWake = () => { void run(); };
        const onDelete = () => schedule(31_000);
        void run();
        window.addEventListener('online', onWake);
        document.addEventListener('visibilitychange', onWake);
        window.addEventListener('pluto:thread-deleted', onDelete);
        return () => {
            disposed = true;
            controller.abort();
            clearTimeout(timer);
            window.removeEventListener('online', onWake);
            document.removeEventListener('visibilitychange', onWake);
            window.removeEventListener('pluto:thread-deleted', onDelete);
        };
    }, [userId]);
}
