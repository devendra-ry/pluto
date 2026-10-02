'use client';

import { createContext, useContext, useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ErrorBoundary } from '@/shared/components/error-boundary';
import { type User } from '@supabase/supabase-js';
import { createClient } from '@/shared/lib/supabase/client';
import { getQueryClient } from '@/shared/lib/query-client';
import { useThreadCleanup } from '../hooks/use-thread-cleanup';

function clearRecoveredDraftStorage() {
    try { window.localStorage.removeItem('pluto:text-drafts:v1'); } catch { /* best effort */ }
    window.dispatchEvent(new CustomEvent('pluto:clear-text-drafts'));
    window.dispatchEvent(new CustomEvent('pluto:clear-markdown-cache'));
    getQueryClient().clear();
}

const AuthUserIdContext = createContext<string | null>(null);

export function useAuthUserId() {
    return useContext(AuthUserIdContext);
}

const SidebarClient = dynamic(
    () => import('@/features/threads').then((mod) => mod.Sidebar),
    { ssr: false }
);

export function ChatLayout({ children, initialUser }: { children: React.ReactNode; initialUser: User | null }) {
    const router = useRouter();
    const [isMobile, setIsMobile] = useState(false);
    const [userId, setUserId] = useState(initialUser?.id ?? null);
    const userIdRef = useRef(initialUser?.id ?? null);
    const serverUserId = initialUser?.id ?? null;
    useThreadCleanup(userId === serverUserId ? userId : null);

    useEffect(() => {
        const supabase = createClient();
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            const nextUserId = session?.user.id ?? null;
            if (userIdRef.current !== nextUserId) clearRecoveredDraftStorage();
            userIdRef.current = nextUserId;
            setUserId(nextUserId);
        });
        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        // Old server hydration data belongs to the previous account. Hide it
        // until the server has resolved the newly authenticated identity.
        if (userId !== serverUserId) router.refresh();
    }, [router, serverUserId, userId]);

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
        <AuthUserIdContext.Provider value={userId}>
            <div className="flex h-dvh min-h-0 bg-background">
                {userId === serverUserId && <SidebarClient key={userId ?? 'anonymous'} isMobileSize={isMobile} initialUser={initialUser} />}
                <main key={userId ?? 'anonymous'} className="relative min-w-0 flex-1 overflow-hidden">
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
                        {userId === serverUserId ? children : (
                            <div role="status" className="flex h-full items-center justify-center text-sm text-muted-foreground">Updating account…</div>
                        )}
                    </ErrorBoundary>
                </main>
            </div>
        </AuthUserIdContext.Provider>
    );
}
