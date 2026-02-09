'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Plus,
    PanelLeftClose,
    PanelLeft,
    Search,
    Pin,
    X,
} from 'lucide-react';
import { useThreads, deleteThread, toggleThreadPin } from '@/hooks/use-threads';
import { type Thread } from '@/lib/db';
import { groupThreadsByDate } from '@/lib/date-utils';
import { useDebouncedValue } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';

export function Sidebar() {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const debouncedSearch = useDebouncedValue(searchQuery, 200);
    const threads = useThreads();
    const pinnedThreads = threads.filter(t => t.isPinned);
    const unpinnedThreads = threads.filter(t => !t.isPinned);
    const groupedThreads = groupThreadsByDate(unpinnedThreads);
    const pathname = usePathname();
    const router = useRouter();

    const filteredPinned = pinnedThreads.filter(t =>
        t.title.toLowerCase().includes(debouncedSearch.toLowerCase())
    );

    const filteredGroups = groupedThreads.map(group => ({
        ...group,
        threads: group.threads.filter(t =>
            t.title.toLowerCase().includes(debouncedSearch.toLowerCase())
        )
    })).filter(g => g.threads.length > 0);

    const handleNewChat = () => {
        router.push('/');
    };

    const handleDeleteClick = (e: React.MouseEvent, threadId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setDeleteConfirm(threadId);
    };

    const handleDeleteConfirm = async (e: React.MouseEvent, threadId: string) => {
        e.preventDefault();
        e.stopPropagation();
        await deleteThread(threadId);
        setDeleteConfirm(null);
        if (pathname === `/c/${threadId}`) {
            router.push('/');
        }
    };

    const handleDeleteCancel = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDeleteConfirm(null);
    };

    const handleTogglePin = async (e: React.MouseEvent, threadId: string, isPinned: boolean) => {
        e.preventDefault();
        e.stopPropagation();
        await toggleThreadPin(threadId, !isPinned);
    };

    if (isCollapsed) {
        return (
            <div className="fixed top-3 left-3 z-[100] flex items-center gap-0.5 bg-[#0f0a12]/80 backdrop-blur-md p-1.5 rounded-xl border border-[#2a1f2f] shadow-2xl">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsCollapsed(false)}
                    className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-[#2a1f2f] transition-all rounded-lg"
                >
                    <PanelLeft className="h-5 w-5" />
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsCollapsed(false)}
                    className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-[#2a1f2f] transition-all rounded-lg"
                >
                    <Search className="h-4.5 w-4.5" />
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleNewChat}
                    className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-[#2a1f2f] transition-all rounded-lg"
                >
                    <Plus className="h-5 w-5" />
                </Button>
            </div>
        );
    }

    const renderThreadItem = (thread: Thread) => {
        const isActive = pathname === `/c/${thread.id}`;
        const isConfirmingDelete = deleteConfirm === thread.id;

        return (
            <div
                key={thread.id}
                className="group relative"
            >
                <Link
                    href={`/c/${thread.id}`}
                    className={cn(
                        'flex items-center gap-2 px-3 py-2 text-[13px] transition-all rounded-lg outline-none min-w-0 relative',
                        isActive
                            ? 'bg-[#2a1f2f] text-zinc-100 font-medium'
                            : 'text-zinc-400 hover:bg-[#1f1623] hover:text-zinc-200'
                    )}
                >
                    <span className="truncate flex-1 min-w-0">{thread.title}</span>
                </Link>

                {/* Delete Confirmation Overlay */}
                {isConfirmingDelete && (
                    <div className="absolute inset-0 bg-[#0f0a12]/95 rounded-lg flex items-center justify-center gap-2 z-10 animate-in fade-in duration-150">
                        <span className="text-xs text-zinc-400 mr-1">Delete?</span>
                        <Button
                            size="sm"
                            className="h-6 px-2 text-xs bg-red-600 hover:bg-red-500 text-white"
                            onClick={(e) => handleDeleteConfirm(e, thread.id)}
                        >
                            Yes
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs text-zinc-400 hover:text-zinc-200"
                            onClick={handleDeleteCancel}
                        >
                            No
                        </Button>
                    </div>
                )}

                {/* Hover Actions */}
                {!isConfirmingDelete && (
                    <div
                        className={cn(
                            "absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pl-2",
                            isActive ? "bg-[#2a1f2f]" : "bg-[#1f1623]",
                            // Add a gradient mask to the left to fade out text
                            "before:absolute before:-left-4 before:top-0 before:bottom-0 before:w-4 text-zinc-500",
                            isActive
                                ? "before:bg-gradient-to-l before:from-[#2a1f2f] before:to-transparent"
                                : "before:bg-gradient-to-l before:from-[#1f1623] before:to-transparent"
                        )}
                    >
                        {/* Pin Button */}
                        <div className="relative group/tooltip">
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                    "h-7 w-7 transition-colors rounded-md",
                                    thread.isPinned ? "text-pink-500 hover:bg-pink-500/10" : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50"
                                )}
                                onClick={(e) => handleTogglePin(e, thread.id, !!thread.isPinned)}
                            >
                                <Pin className={cn("h-3.5 w-3.5 transform rotate-45", thread.isPinned && "fill-current")} />
                            </Button>
                            <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-black text-[10px] text-white rounded whitespace-nowrap opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity z-50">
                                {thread.isPinned ? 'Unpin Thread' : 'Pin Thread'}
                            </div>
                        </div>

                        {/* Delete Button */}
                        <div className="relative group/tooltip">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-zinc-500 hover:text-red-400 hover:bg-red-900/20 rounded-md"
                                onClick={(e) => handleDeleteClick(e, thread.id)}
                            >
                                <X className="h-3.5 w-3.5" />
                            </Button>
                            <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-black text-[10px] text-white rounded whitespace-nowrap opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity z-50">
                                Delete Thread
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <aside className="h-screen w-[260px] flex flex-col bg-[#0f0a12] border-r border-[#2a1f2f] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 pb-2">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsCollapsed(true)}
                    className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-[#2a1f2f]"
                >
                    <PanelLeftClose className="h-5 w-5" />
                </Button>
                <span className="font-bold text-zinc-100 text-2xl">dev.chat</span>
                <div className="w-9" />
            </div>

            {/* New Chat Button */}
            <div className="px-3 pb-2 pt-2">
                <Button
                    onClick={handleNewChat}
                    className="w-full h-9 bg-gradient-to-r from-pink-700/90 to-pink-600/90 hover:from-pink-600/90 hover:to-pink-500/90 text-pink-100 font-medium rounded-lg border border-pink-500/20 shadow-pink-500/10 shadow-sm text-[13px] transition-all"
                >
                    New Chat
                </Button>
            </div>

            {/* Search */}
            <div className="px-3 pb-4">
                <div className="flex items-center gap-2 px-3 py-2 text-zinc-500 group">
                    <Search className="h-4 w-4 group-focus-within:text-zinc-300 transition-colors" />
                    <input
                        type="text"
                        placeholder="Search your threads..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-1 bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
                    />
                </div>
            </div>

            {/* Chat List */}
            <ScrollArea className="flex-1">
                <div className="p-2 pt-0">
                    {/* Pinned Section */}
                    {filteredPinned.length > 0 && (
                        <div className="mb-4">
                            <h3 className="text-xs font-semibold text-pink-500/90 px-4 py-2 mb-1">
                                Pinned
                            </h3>
                            <div className="space-y-0.5 px-2">
                                {filteredPinned.map(renderThreadItem)}
                            </div>
                        </div>
                    )}

                    {/* Grouped Threads */}
                    {filteredGroups.length === 0 && filteredPinned.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-sm text-zinc-600">
                                {searchQuery ? 'No results found' : 'No conversations yet'}
                            </p>
                        </div>
                    ) : (
                        filteredGroups.map((group) => (
                            <div key={group.label} className="mb-6">
                                <h3 className="text-xs font-semibold text-pink-500/90 px-4 py-2 mb-1">
                                    {group.label}
                                </h3>
                                <div className="space-y-0.5 px-2">
                                    {group.threads.map(renderThreadItem)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </ScrollArea>
        </aside>
    );
}
