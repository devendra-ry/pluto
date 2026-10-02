import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useThread } from '../../../src/features/threads/hooks/use-threads';
import type { Thread } from '../../../src/shared/contracts/thread';
import type {} from './thread-prefetch-mock';

declare global {
    interface Window {
        __threadPrefetchSeed: { id: string; initialThread: Thread | null };
        threadPrefetchHarness: {
            snapshot: { id: string; renderedId: string | null; title: string | null };
            firstCommit: { id: string; renderedId: string | null; title: string | null };
            navigate: (id: string, initialThread?: Thread | null) => void;
        };
    }
}

function Harness() {
    const [route, setRoute] = useState(window.__threadPrefetchSeed);
    const thread = useThread(route.id, route.initialThread ?? undefined);
    const firstCommitRef = useRef<{ id: string; renderedId: string | null; title: string | null } | null>(null);
    const snapshot = useMemo(() => ({
        id: route.id,
        renderedId: thread?.id ?? null,
        title: thread?.title ?? null,
    }), [route.id, thread?.id, thread?.title]);

    useLayoutEffect(() => {
        firstCommitRef.current ??= snapshot;
        window.threadPrefetchHarness = {
            snapshot,
            firstCommit: firstCommitRef.current,
            navigate: (id, initialThread = null) => setRoute({ id, initialThread }),
        };
    }, [snapshot]);

    return <output aria-label="Current thread" data-thread-id={thread?.id ?? ''}>{thread?.title ?? 'No thread'}</output>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
