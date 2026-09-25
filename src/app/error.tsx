'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function AppError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[app-error-boundary]', {
            message: error.message,
            digest: error.digest,
        });
    }, [error]);

    return (
        <main className="flex min-h-screen items-center justify-center bg-background px-6">
            <Alert variant="destructive" className="w-full max-w-lg rounded-2xl p-6">
                <h1 className="text-xl font-semibold">Something went wrong</h1>
                <AlertDescription className="mt-2">
                    <p>A recoverable application error occurred.</p>
                    {error.digest && <p className="mt-3 text-xs">Error ID: {error.digest}</p>}
                </AlertDescription>
                <div className="mt-5 flex flex-wrap gap-2">
                    <Button onClick={reset}>
                        Try again
                    </Button>
                    <Button variant="outline" onClick={() => window.location.reload()}>
                        Reload page
                    </Button>
                </div>
            </Alert>
        </main>
    );
}
