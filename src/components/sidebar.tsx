'use client';

import { useState, useEffect, useMemo, memo, useCallback } from 'react';
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
    LogIn,
    User,
    LogOut,
} from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { type User as SupabaseUser } from '@supabase/supabase-js';
import { List } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { motion, AnimatePresence } from 'framer-motion';
import { useThreads, deleteThread, toggleThreadPin, cleanupEmptyThreads } from '@/hooks/use-threads';
import { type Thread } from '@/hooks/use-threads';
import { groupThreadsByDate } from '@/lib/date-utils';
import { useDebouncedValue } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

interface SidebarProps {
    isMobileSize?: boolean;
}

interface SidebarRowProps {
    index: number;
    style: React.CSSProperties;
    virtualItems: ({ type: 'header'; label: string } | { type: 'thread'; data: Thread })[];
    renderThreadItem: (thread: Thread) => React.ReactNode;
}

const SidebarRow = memo(({ index, style, virtualItems, renderThreadItem }: any) => {
    const item = virtualItems?.[index];
    if (!item) return <div style={style} />;

    if (item.type === 'header') {
        return (
            <div style={style}>
                <h3 className="text-xs font-semibold text-pink-500/90 px-4 py-2 mt-4 mb-1 first:mt-0">
                    {item.label}
                </h3>
            </div>
        );
    }

    return (
        <div style={style} className="px-2 space-y-0.5">
            {renderThreadItem(item.data)}
        </div>
    );
}) as any;

SidebarRow.displayName = 'SidebarRow';

const Sidebar = memo(function Sidebar({ isMobileSize = false }: SidebarProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const debouncedSearch = useDebouncedValue(searchQuery, 300);
    const { threads, refreshThreads } = useThreads();

    const [supabase] = useState(() => createClient());

    useEffect(() => {
        const getUser = async () => {
            const { data: authData } = await supabase.auth.getUser();
            setUser(authData?.user ?? null);
        };
        getUser();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, [supabase]);

    // Load collapsed state on mount
    useEffect(() => {
        const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
        if (saved !== null) {
            setIsCollapsed(saved === 'true');
        }
    }, []);
    const pinnedThreads = useMemo(() => threads.filter(t => t.is_pinned), [threads]);
    const unpinnedThreads = useMemo(() => threads.filter(t => !t.is_pinned), [threads]);
    const groupedThreads = useMemo(() => groupThreadsByDate(unpinnedThreads), [unpinnedThreads]);
    const pathname = usePathname();
    const router = useRouter();

    // Clear collapsed state on mobile or small screens
    useEffect(() => {
        if (isMobileSize) {
            setIsCollapsed(true);
        }
    }, [isMobileSize]);

    // Persist collapsed state to localStorage (only if not on mobile)
    useEffect(() => {
        if (!isMobileSize) {
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
        }
    }, [isCollapsed, isMobileSize]);


    // Cleanup empty threads on mount
    useEffect(() => {
        const chatId = pathname?.split('/').pop();
        cleanupEmptyThreads(chatId);
    }, [pathname]); // Run when pathname changes

    const filteredPinned = useMemo(() => pinnedThreads.filter(t =>
        t.title.toLowerCase().includes(debouncedSearch.toLowerCase())
    ), [pinnedThreads, debouncedSearch]);

    const filteredGroups = useMemo(() => groupedThreads.map(group => ({
        ...group,
        threads: group.threads.filter(t =>
            t.title.toLowerCase().includes(debouncedSearch.toLowerCase())
        )
    })).filter(g => g.threads.length > 0), [groupedThreads, debouncedSearch]);

    // Flatten filtered threads and headers into items for virtualization
    const virtualItems = useMemo(() => {
        const items: (({ type: 'header'; label: string } | { type: 'thread'; data: Thread }))[] = [];

        if (filteredPinned.length > 0) {
            items.push({ type: 'header', label: 'Pinned' });
            filteredPinned.forEach(t => items.push({ type: 'thread', data: t }));
        }

        filteredGroups.forEach(group => {
            items.push({ type: 'header', label: group.label });
            group.threads.forEach(t => items.push({ type: 'thread', data: t }));
        });

        return items;
    }, [filteredPinned, filteredGroups]);

    const getRowHeight = (index: number) => {
        const item = virtualItems[index];
        if (item.type === 'header') return 36; // Header height
        return 42; // Thread item height
    };

    const handleNewChat = useCallback(() => {
        router.push('/');
    }, [router]);

    const handleDeleteClick = useCallback((e: React.MouseEvent, threadId: string) => {
        try {
            e.preventDefault();
            e.stopPropagation();
            setDeleteConfirm(threadId);
        } catch (err) {
            console.error('[Sidebar] Error in handleDeleteClick:', err);
        }
    }, []);

    const handleDeleteConfirm = useCallback(async (e: React.MouseEvent, threadId: string) => {
        try {
            e.preventDefault();
            e.stopPropagation();
            await deleteThread(threadId);
            setDeleteConfirm(null);

            // Manually refresh threads as a fallback for realtime
            await refreshThreads();

            if (pathname === `/c/${threadId}`) {
                router.push('/');
            }
        } catch (err) {
            console.error('[Sidebar] Error in handleDeleteConfirm:', err);
        }
    }, [pathname, router, deleteThread, refreshThreads]);

    const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
        try {
            e.preventDefault();
            e.stopPropagation();
            setDeleteConfirm(null);
        } catch (err) {
            console.error('[Sidebar] Error in handleDeleteCancel:', err);
        }
    }, []);

    const handleTogglePin = useCallback(async (e: React.MouseEvent, threadId: string, isPinned: boolean) => {
        try {
            e.preventDefault();
            e.stopPropagation();
            await toggleThreadPin(threadId, !isPinned);

            // Manually refresh threads as a fallback for realtime
            await refreshThreads();
        } catch (err) {
            console.error('[Sidebar] Error in handleTogglePin:', err);
        }
    }, [toggleThreadPin, refreshThreads]);


    const renderThreadItem = useCallback((thread: Thread) => {
        const isActive = pathname === `/c/${thread.id}`;
        const isConfirmingDelete = deleteConfirm === thread.id;

        return (
            <div
                className={cn(
                    "group relative rounded-lg transition-colors",
                    isActive
                        ? "bg-[#2a1f2f]"
                        : "hover:bg-[#1f1623]"
                )}
            >
                <Link
                    href={`/c/${thread.id}`}
                    className={cn(
                        'flex items-center gap-2 px-3 py-2 text-[13px] transition-all rounded-lg outline-none min-w-0 relative overflow-hidden',
                        isActive
                            ? 'text-zinc-100 font-medium'
                            : 'text-zinc-400 group-hover:text-zinc-200'
                    )}
                >
                    <span className="truncate flex-1 min-w-0 break-all transition-all duration-300 group-hover:text-clip group-hover:[mask-image:linear-gradient(to_right,black_0%,black_calc(100%-150px),transparent_calc(100%-50px))]">
                        {thread.title}
                    </span>
                </Link>

                {/* Delete Confirmation Overlay */}
                {isConfirmingDelete && (
                    <div className="absolute inset-0 bg-[#0f0a12]/95 rounded-lg flex items-center justify-center gap-2 z-20 animate-in fade-in duration-150">
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
                        className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 h-full pr-1 z-10"
                    >
                        {/* Pin Button */}
                        <div className="relative group/tooltip">
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                    "h-7 w-7 transition-colors rounded-md",
                                    thread.is_pinned ? "text-pink-500 hover:bg-pink-500/10" : "text-zinc-500 hover:text-pink-400 hover:bg-pink-500/10"
                                )}
                                onClick={(e) => handleTogglePin(e, thread.id, !!thread.is_pinned)}
                            >
                                <Pin className={cn("h-3.5 w-3.5 transform rotate-45", thread.is_pinned && "fill-current")} />
                            </Button>
                            <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-black text-[10px] text-white rounded whitespace-nowrap opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity z-50">
                                {thread.is_pinned ? 'Unpin Thread' : 'Pin Thread'}
                            </div>
                        </div>

                        {/* Delete Button */}
                        <div className="relative group/tooltip">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all"
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
    }, [pathname, deleteConfirm, handleDeleteConfirm, handleDeleteCancel, handleTogglePin, handleDeleteClick]);

    const rowProps = useMemo(() => ({
        virtualItems,
        renderThreadItem
    }), [virtualItems, renderThreadItem]);

    return (
        <>
            {/* Mobile Backdrop */}
            <AnimatePresence>
                {isMobileSize && !isCollapsed && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setIsCollapsed(true)}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30"
                    />
                )}
            </AnimatePresence>

            {/* Animated Sidebar */}
            <motion.aside
                initial={isCollapsed ? "collapsed" : "expanded"}
                animate={isCollapsed ? "collapsed" : "expanded"}
                variants={{
                    expanded: {
                        width: 260,
                        opacity: 1,
                        x: 0,
                        borderRightWidth: 1,
                        transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
                    },
                    collapsed: {
                        width: isMobileSize ? 0 : 0,
                        opacity: isMobileSize ? 1 : 0,
                        x: isMobileSize ? -260 : 0,
                        borderRightWidth: 0,
                        transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
                    }
                }}
                className={cn(
                    "h-screen flex flex-col bg-[#0f0a12] border-[#2a1f2f] overflow-hidden whitespace-nowrap z-40 transition-shadow",
                    isMobileSize ? "fixed left-0 top-0 shadow-2xl" : "relative"
                )}
            >

                <div className="w-[260px] flex flex-col h-full shrink-0">
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
                        <span className="font-bold text-zinc-100 text-2xl px-1">dev Chat</span>
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
                        <div className="flex items-center gap-2 px-3 py-2 text-zinc-500 group bg-zinc-900/30 rounded-lg border border-white/[0.03]">
                            <Search className="h-4 w-4 group-focus-within:text-zinc-300 transition-colors" />
                            <input
                                type="text"
                                placeholder="Search conversations..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="flex-1 bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
                            />
                        </div>
                    </div>

                    {/* Chat List */}
                    <div className="flex-1 min-h-0">
                        <div className="h-full w-full relative px-2">
                            {virtualItems.length === 0 ? (
                                <div className="text-center py-12">
                                    <p className="text-sm text-zinc-600">
                                        {searchQuery ? 'No results found' : 'No conversations yet'}
                                    </p>
                                </div>
                            ) : (
                                <div className="h-full w-full relative">
                                    <AutoSizer
                                        renderProp={({ height, width }) => (
                                            <List
                                                rowCount={virtualItems.length}
                                                rowHeight={42}
                                                className="scrollbar-none"
                                                rowComponent={SidebarRow}
                                                rowProps={rowProps as any}
                                                style={{ height: height || 400, width: width || 260 }}
                                            />
                                        )}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer / Login */}
                    <div className="mt-auto border-t border-[#2a1f2f] p-4">
                        {user ? (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <div className="w-8 h-8 rounded-full bg-pink-500/20 flex items-center justify-center shrink-0">
                                        <User className="h-4 w-4 text-pink-500" />
                                    </div>
                                    <span className="text-sm text-zinc-300 truncate">
                                        {user.email}
                                    </span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-zinc-500 hover:text-zinc-200"
                                    onClick={() => supabase.auth.signOut()}
                                >
                                    <LogOut className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <Link href="/login" className="flex items-center gap-3 px-3 py-2 text-zinc-400 hover:text-zinc-100 hover:bg-[#2a1f2f] rounded-lg transition-colors">
                                <LogIn className="h-5 w-5" />
                                <span className="text-sm font-medium">Sign in</span>
                            </Link>
                        )}
                    </div>
                </div>
            </motion.aside>

            {/* Floating Pill for Collapsed State */}
            <AnimatePresence mode="wait">
                {isCollapsed && (
                    <motion.div
                        initial={{ x: -20, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -20, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="fixed top-3 left-3 z-[100] flex items-center gap-0.5 bg-[#1a1121]/90 backdrop-blur-xl p-1.5 rounded-xl border border-pink-500/20 shadow-2xl shadow-pink-500/5 ring-1 ring-white/10"
                    >
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsCollapsed(false)}
                            className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-[#2a1f2f] transition-all rounded-lg"
                        >
                            <PanelLeft className="h-5 w-5" />
                        </Button>

                        <div className="w-px h-4 bg-[#2a1f2f] mx-0.5" />

                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsCollapsed(false)}
                            className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-[#2a1f2f] transition-all rounded-lg"
                        >
                            <Search className="h-4.5 w-4.5" />
                        </Button>

                        <div className="w-px h-4 bg-[#2a1f2f] mx-0.5" />

                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleNewChat}
                            className="h-9 w-9 text-pink-500 hover:text-pink-400 hover:bg-pink-500/10 transition-all rounded-lg"
                        >
                            <Plus className="h-5 w-5" />
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
});

export { Sidebar };
