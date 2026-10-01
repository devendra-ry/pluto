'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ErrorBoundary } from '@/shared/components/error-boundary';
import { type User } from '@supabase/supabase-js';

const SidebarClient = dynamic(
    () => import('@/features/threads').then((mod) => mod.Sidebar),
    { ssr: false }
);

export function ChatLayout({ children, initialUser }: { children: React.ReactNode; initialUser: User | null }) {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(max-width: 767px)');
        const updateFromMediaQuery = () => {
            setIsMobile(mediaQuery.matches);
        };

        updateFromMediaQuery();
        mediaQuery.addEventListener('change', updateFromMediaQuery);
        return () => mediaQuery.removeEventListener('change', updateFromMediaQuery);
    }, []);

    return (
        <div className="flex h-dvh min-h-0 bg-background">
            <SidebarClient isMobileSize={isMobile} initialUser={initialUser} />
            <main className="relative min-w-0 flex-1 overflow-hidden">
                <ErrorBoundary
                    onError={(error) => {
                        console.error('[ui] main-content-boundary', error);
                    }}
                    fallback={(
                        <div className="flex h-full items-center justify-center px-6">
                            <div className="w-full max-w-lg rounded-2xl border border-destructive/30 bg-card p-6 text-foreground">
                                <h2 className="text-lg font-semibold">Main content failed to render</h2>
                                <p className="mt-2 text-sm text-foreground">
                                    The sidebar is still available. You can refresh this page to recover.
                                </p>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="mt-4 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
                                >
                                    Reload page
                                </button>
                            </div>
                        </div>
                    )}
                >
                    {children}
                </ErrorBoundary>
            </main>
        </div>
    );
}
