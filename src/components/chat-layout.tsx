'use client';

import { Sidebar } from '@/components/sidebar';

export function ChatLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-screen bg-[#1a1520]">
            <Sidebar />
            <main className="flex-1 overflow-hidden relative">
                {children}
            </main>
        </div>
    );
}
