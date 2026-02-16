'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/sidebar';
import { ErrorBoundary } from '@/components/error-boundary';
import { type User } from '@supabase/supabase-js';

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
        <div className="flex h-screen bg-[#1a1520]">
            <Sidebar isMobileSize={isMobile} initialUser={initialUser} />
            <main className="flex-1 overflow-hidden relative">
                <ErrorBoundary
                    onError={(error) => {
                        console.error('[ui] main-content-boundary', error);
                    }}
                    fallback={(
                        <div className="flex h-full items-center justify-center px-6">
                            <div className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-red-950/20 p-6 text-zinc-100">
                                <h2 className="text-lg font-semibold">Main content failed to render</h2>
                                <p className="mt-2 text-sm text-zinc-300">
                                    The sidebar is still available. You can refresh this page to recover.
                                </p>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="mt-4 rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
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

