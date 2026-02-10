'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/sidebar';
import { type User } from '@supabase/supabase-js';

export function ChatLayout({ children, initialUser }: { children: React.ReactNode; initialUser: User | null }) {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    return (
        <div className="flex h-screen bg-[#1a1520]">
            <Sidebar isMobileSize={isMobile} initialUser={initialUser} />
            <main className="flex-1 overflow-hidden relative">
                {children}
            </main>
        </div>
    );
}

