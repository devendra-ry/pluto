'use client';

import { useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[global-error-boundary]', {
            message: error.message,
            digest: error.digest,
        });
    }, [error]);

    return (
        <html lang="en" className="dark">
            <body className="m-0 bg-background text-foreground">
                <div className="flex min-h-screen items-center justify-center px-6">
                    <Alert variant="destructive" className="w-full max-w-lg rounded-2xl p-6">
                        <h1 className="text-xl font-semibold">A critical error occurred</h1>
                        <AlertDescription className="mt-2">
                            <p>The app shell failed to render. Try recovering with reset or reload.</p>
                            {error.digest && <p className="mt-3 text-xs">Error ID: {error.digest}</p>}
                        </AlertDescription>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button
                                onClick={reset}
                                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                Try again
                            </button>
                            <button
                                onClick={() => window.location.reload()}
                                className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                Reload page
                            </button>
                        </div>
                    </Alert>
                </div>
            </body>
        </html>
    );
}
