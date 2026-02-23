'use client';

import { useEffect } from 'react';

export default function ChatRouteError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[chat-route-error-boundary]', {
            message: error.message,
            digest: error.digest,
        });
    }, [error]);

    return (
        <div className="flex h-full items-center justify-center px-6">
            <div className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-red-950/20 p-6 text-zinc-100">
                <h1 className="text-xl font-semibold">Chat failed to render</h1>
                <p className="mt-2 text-sm text-zinc-300">
                    This error is isolated to the current chat route.
                </p>
                {error.digest && (
                    <p className="mt-3 text-xs text-zinc-400">
                        Error ID: {error.digest}
                    </p>
                )}
                <div className="mt-5 flex gap-2">
                    <button
                        onClick={reset}
                        className="rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                    >
                        Try again
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        className="rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                    >
                        Reload page
                    </button>
                </div>
            </div>
        </div>
    );
}