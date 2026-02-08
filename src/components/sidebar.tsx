'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Plus,
    MessageSquare,
    Trash2,
    PanelLeftClose,
    PanelLeft,
    Search
} from 'lucide-react';
import { useThreads, deleteThread, createThread } from '@/hooks/use-threads';
import { groupThreadsByDate } from '@/lib/date-utils';
import { DEFAULT_MODEL } from '@/lib/constants';
import { cn } from '@/lib/utils';

export function Sidebar() {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const threads = useThreads();
    const groupedThreads = groupThreadsByDate(threads);
    const pathname = usePathname();
    const router = useRouter();

    const filteredGroups = searchQuery
        ? groupedThreads.map(group => ({
            ...group,
            threads: group.threads.filter(t =>
                t.title.toLowerCase().includes(searchQuery.toLowerCase())
            )
        })).filter(g => g.threads.length > 0)
        : groupedThreads;

    const handleNewChat = async () => {
        const newThread = await createThread(DEFAULT_MODEL);
        router.push(`/c/${newThread.id}`);
    };

    const handleDelete = async (e: React.MouseEvent, threadId: string) => {
        e.preventDefault();
        e.stopPropagation();
        await deleteThread(threadId);
        if (pathname === `/c/${threadId}`) {
            handleNewChat();
        }
    };

    if (isCollapsed) {
        return (
            <aside className="h-screen w-14 flex flex-col bg-[#110b14] border-r border-[#2a1f2f]">
                <div className="flex items-center justify-center p-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsCollapsed(false)}
                        className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-[#2a1f2f]"
                    >
                        <PanelLeft className="h-5 w-5" />
                    </Button>
                </div>
                <div className="flex-1" />
            </aside>
        );
    }

    return (
        <aside className="h-screen w-72 flex flex-col bg-[#110b14] border-r border-[#2a1f2f]">
            {/* Header - Toggle left, Title center */}
            <div className="flex items-center justify-between p-3">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsCollapsed(true)}
                    className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-[#2a1f2f]"
                >
                    <PanelLeftClose className="h-5 w-5" />
                </Button>
                <span className="font-semibold text-zinc-100 text-lg tracking-wide">Pluto</span>
                <div className="w-9" />
            </div>

            {/* New Chat Button - Pink gradient with glow */}
            <div className="px-3 pb-3">
                <Button
                    onClick={handleNewChat}
                    className="w-full h-10 bg-gradient-to-r from-pink-700/80 to-pink-600/80 hover:from-pink-600/80 hover:to-pink-500/80 text-pink-200 font-medium rounded-xl border border-pink-500/30 shadow-[0_0_20px_rgba(236,72,153,0.15)]"
                >
                    New Chat
                </Button>
            </div>

            {/* Search */}
            <div className="px-3 pb-3">
                <div className="flex items-center gap-2 px-3 py-2 text-zinc-500">
                    <Search className="h-4 w-4" />
                    <input
                        type="text"
                        placeholder="Search your threads..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-1 bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
                    />
                </div>
            </div>

            <div className="border-t border-[#2a1f2f]" />

            {/* Chat List */}
            <ScrollArea className="flex-1">
                <div className="p-2">
                    {filteredGroups.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-sm text-zinc-600">
                                {searchQuery ? 'No results found' : 'No conversations yet'}
                            </p>
                        </div>
                    ) : (
                        filteredGroups.map((group) => (
                            <div key={group.label} className="mb-4">
                                <h3 className="text-xs font-medium text-zinc-600 px-2 py-1.5 uppercase tracking-wider">
                                    {group.label}
                                </h3>
                                <div className="space-y-0.5">
                                    {group.threads.map((thread) => {
                                        const isActive = pathname === `/c/${thread.id}`;
                                        return (
                                            <Link
                                                key={thread.id}
                                                href={`/c/${thread.id}`}
                                                className={cn(
                                                    'group flex items-center gap-2 px-2 py-2.5 rounded-lg text-sm transition-all',
                                                    isActive
                                                        ? 'bg-[#2a1f2f] text-zinc-100'
                                                        : 'text-zinc-400 hover:bg-[#1f1825] hover:text-zinc-200'
                                                )}
                                            >
                                                <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />
                                                <span className="truncate flex-1">{thread.title}</span>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                                    onClick={(e) => handleDelete(e, thread.id)}
                                                >
                                                    <Trash2 className="h-3 w-3 text-zinc-500 hover:text-red-400" />
                                                </Button>
                                            </Link>
                                        );
                                    })}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </ScrollArea>
        </aside>
    );
}
