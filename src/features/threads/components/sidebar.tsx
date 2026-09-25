'use client';

import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
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
import { createClient } from '@/shared/lib/supabase/client';
import { type User as SupabaseUser } from '@supabase/supabase-js';
import { List, type RowComponentProps } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { useThreads } from '../hooks/use-threads';
import { deleteThread, toggleThreadPin } from '../lib/thread-mutations';
import { type Thread } from '@/shared/contracts/thread';
import { groupThreadsByDate } from '../lib/date-utils';
import { useDebouncedValue } from '@/shared/hooks/use-debounce';
import { cn } from '@/shared/core/utils';
import { useToast } from '@/components/ui/toast';

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

interface SidebarProps {
    isMobileSize?: boolean;
    initialUser: SupabaseUser | null;
}

type VirtualItem = { type: 'header'; label: string } | { type: 'thread'; data: Thread };

interface SidebarRowData {
    virtualItems: VirtualItem[];
    renderThreadItem: (thread: Thread) => React.ReactNode;
}

type SidebarRowProps = RowComponentProps<SidebarRowData>;

function SidebarRow({ index, style, ariaAttributes, virtualItems, renderThreadItem }: SidebarRowProps) {
    const item = virtualItems?.[index];
    if (!item) return <div style={style} {...ariaAttributes} />;

    if (item.type === 'header') {
        return (
            <div style={style} {...ariaAttributes}>
                <h3 className="text-sm font-semibold text-brand-500/90 px-4 py-2 mt-4 mb-1 first:mt-0">
                    {item.label}
                </h3>
            </div>
        );
    }

    return (
        <div style={style} className="px-2 space-y-0.5" {...ariaAttributes}>
            {renderThreadItem(item.data)}
        </div>
    );
}

const Sidebar = memo(function Sidebar({ isMobileSize = false, initialUser }: SidebarProps) {
    const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    });
    const [mobileOpen, setMobileOpen] = useState(false);
    const isCollapsed = isMobileSize ? !mobileOpen : desktopCollapsed;

    const [searchQuery, setSearchQuery] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<Thread | null>(null);
    const [deletePending, setDeletePending] = useState(false);
    const [hiddenDeletedThreadIds, setHiddenDeletedThreadIds] = useState<Set<string>>(() => new Set());
    const [user, setUser] = useState<SupabaseUser | null>(initialUser);
    const debouncedSearch = useDebouncedValue(searchQuery, 300);
    const { threads, loadMoreThreads, hasMoreThreads } = useThreads();
    const { showToast } = useToast();

    const [supabase] = useState(() => createClient());

    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, [supabase]);

    const visibleThreads = useMemo(
        () => threads.filter((thread) => !hiddenDeletedThreadIds.has(thread.id)),
        [threads, hiddenDeletedThreadIds]
    );
    const pinnedThreads = useMemo(() => visibleThreads.filter(t => t.is_pinned), [visibleThreads]);
    const unpinnedThreads = useMemo(() => visibleThreads.filter(t => !t.is_pinned), [visibleThreads]);
    const groupedThreads = useMemo(() => groupThreadsByDate(unpinnedThreads), [unpinnedThreads]);
    const pathname = usePathname();
    const router = useRouter();

    // Persist desktop collapsed state.
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(desktopCollapsed));
        }
    }, [desktopCollapsed]);

    const filteredPinned = useMemo(() => pinnedThreads.filter(t =>
        t.title.toLowerCase().includes(debouncedSearch.toLowerCase())
    ), [pinnedThreads, debouncedSearch]);

    const filteredGroups = useMemo(() => groupedThreads.map(group => ({
        ...group,
        threads: group.threads.filter(t =>
            t.title.toLowerCase().includes(debouncedSearch.toLowerCase())
        )
    })).filter(g => g.threads.length > 0), [groupedThreads, debouncedSearch]);

    useEffect(() => {
        if (!debouncedSearch.trim() || !hasMoreThreads) return;
        let active = true;
        void (async () => {
            while (active && await loadMoreThreads()) {
                // Searching spans older pages; normal browsing loads them on scroll.
            }
        })();
        return () => { active = false; };
    }, [debouncedSearch, hasMoreThreads, loadMoreThreads]);

    // Flatten filtered threads and headers into items for virtualization
    const virtualItems = useMemo(() => {
        const items: VirtualItem[] = [];

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

    const handleRowsRendered = useCallback(({ stopIndex }: { startIndex: number; stopIndex: number }) => {
        if (hasMoreThreads && stopIndex >= Math.max(0, virtualItems.length - 12)) {
            void loadMoreThreads();
        }
    }, [hasMoreThreads, loadMoreThreads, virtualItems.length]);

    const collapseSidebar = useCallback(() => {
        if (isMobileSize) {
            setMobileOpen(false);
        } else {
            setDesktopCollapsed(true);
        }
    }, [isMobileSize]);

    const expandSidebar = useCallback(() => {
        if (isMobileSize) {
            setMobileOpen(true);
        } else {
            setDesktopCollapsed(false);
        }
    }, [isMobileSize]);

    const handleNewChat = useCallback(() => {
        router.push('/');
    }, [router]);

    const handleDeleteClick = useCallback((e: React.MouseEvent, thread: Thread) => {
        try {
            e.preventDefault();
            e.stopPropagation();
            setDeleteConfirm(thread);
        } catch (err) {
            console.error('[Sidebar] Error in handleDeleteClick:', err);
        }
    }, []);

    const handleDeleteConfirm = useCallback(async () => {
        if (!deleteConfirm) return;

        const threadId = deleteConfirm.id;
        setHiddenDeletedThreadIds((previous) => new Set(previous).add(threadId));
        setDeletePending(true);
        if (pathname === `/c/${threadId}`) {
            router.push('/');
        }
        try {
            await deleteThread(threadId);
            setDeleteConfirm(null);
        } catch (err) {
            setHiddenDeletedThreadIds((previous) => {
                const next = new Set(previous);
                next.delete(threadId);
                return next;
            });
            setDeleteConfirm(null);
            console.error('[Sidebar] Error in handleDeleteConfirm:', err);
            showToast('Failed to delete thread', 'error');
        } finally {
            setDeletePending(false);
        }
    }, [deleteConfirm, pathname, router, showToast]);

    const handleDeleteCancel = useCallback(() => {
        try {
            if (deletePending) return;
            setDeleteConfirm(null);
        } catch (err) {
            console.error('[Sidebar] Error in handleDeleteCancel:', err);
        }
    }, [deletePending]);

    const handleTogglePin = useCallback(async (e: React.MouseEvent, threadId: string, isPinned: boolean) => {
        try {
            e.preventDefault();
            e.stopPropagation();
            await toggleThreadPin(threadId, !isPinned);
        } catch (err) {
            console.error('[Sidebar] Error in handleTogglePin:', err);
            showToast('Failed to update pin status', 'error');
        }
    }, [showToast]);


    const renderThreadItem = useCallback((thread: Thread) => {
        const isActive = pathname === `/c/${thread.id}`;

        return (
            <div
                className={cn(
                    "group relative rounded-lg transition-colors",
                    isActive
                        ? "bg-plum-700"
                        : "hover:bg-plum-800"
                )}
            >
                <Link
                    href={`/c/${thread.id}`}
                    className={cn(
                        'flex items-center gap-2 px-3 py-2 text-sm transition-all rounded-lg outline-none min-w-0 relative overflow-hidden',
                        isActive
                            ? 'text-zinc-100 font-medium'
                            : 'text-zinc-400 group-hover:text-zinc-200'
                    )}
                >
                    <span className={cn(
                        "truncate flex-1 min-w-0 break-all transition-all duration-300",
                        "mask-thread-title md:mask-none md:group-hover:mask-thread-title"
                    )}>
                        {thread.title}
                    </span>
                </Link>

                {/* Hover Actions */}
                <div
                    className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 h-full pr-1 z-10"
                >
                    {/* Pin Button */}
                    <div className="relative group/tooltip">
                        <Button
                            variant="ghost"
                            size="icon"
                            type="button"
                            aria-label={thread.is_pinned ? 'Unpin thread' : 'Pin thread'}
                            title={thread.is_pinned ? 'Unpin thread' : 'Pin thread'}
                            className={cn(
                                "h-7 w-7 transition-colors rounded-md",
                                thread.is_pinned ? "text-brand-500 hover:bg-brand-500/10" : "text-zinc-500 hover:text-brand-400 hover:bg-brand-500/10"
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
                            type="button"
                            aria-label="Delete thread"
                            title="Delete thread"
                            className="h-8 w-8 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all"
                            onClick={(e) => handleDeleteClick(e, thread)}
                        >
                            <X className="h-3.5 w-3.5" />
                        </Button>
                        <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-black text-[10px] text-white rounded whitespace-nowrap opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity z-50">
                            Delete Thread
                        </div>
                    </div>
                </div>
            </div>
        );
    }, [pathname, handleTogglePin, handleDeleteClick]);

    const rowProps = useMemo<SidebarRowData>(() => ({
        virtualItems,
        renderThreadItem
    }), [virtualItems, renderThreadItem]);

    return (
        <>
            {/* Mobile Backdrop */}
            {isMobileSize && (
                <div
                    onClick={collapseSidebar}
                    className={cn(
                        'fixed inset-0 bg-black/60 backdrop-blur-sm z-30 transition-opacity duration-300 ease-out',
                        isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                    )}
                />
            )}

            {/* Animated Sidebar */}
            <aside
                className={cn(
                    'h-screen flex flex-col bg-plum-950 border-plum-700 overflow-hidden whitespace-nowrap z-40 border-r',
                    'transition-[width,transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                    isMobileSize ? 'fixed left-0 top-0 shadow-2xl' : 'relative',
                    isCollapsed
                        ? (isMobileSize ? 'w-0 -translate-x-full' : 'w-0 opacity-0 border-r-0')
                        : 'w-[260px]'
                )}
            >

                <div className="w-[260px] flex flex-col h-full shrink-0">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 pb-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Collapse sidebar"
                            title="Collapse sidebar"
                            onClick={collapseSidebar}
                            className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-plum-700"
                        >
                            <PanelLeftClose className="h-5 w-5" />
                        </Button>
                        <span className="font-bold text-zinc-100 text-2xl px-1">Pluto</span>
                        <div className="w-9" />
                    </div>

                    {/* New Chat Button */}
                    <div className="px-3 pb-2 pt-2">
                        <Button
                            onClick={handleNewChat}
                            className="w-full h-9 bg-gradient-to-r from-brand-700/90 to-brand-600/90 hover:from-brand-600/90 hover:to-brand-500/90 text-brand-100 font-medium rounded-lg border border-brand-500/20 shadow-brand-500/10 shadow-sm text-sm transition-all"
                        >
                            New Chat
                        </Button>
                    </div>

                    {/* Search */}
                    <div className="px-3 pb-4">
                        <div className="flex items-center gap-2 px-3 py-2 text-zinc-500 group bg-zinc-900/30 rounded-lg border border-white/[0.03]">
                            <Search className="h-5 w-5 text-zinc-500 group-focus-within:text-zinc-300 transition-colors shrink-0" />
                            <Input
                                type="text"
                                placeholder="Search conversations..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-base text-zinc-300 shadow-none placeholder:text-zinc-600 focus-visible:outline-none"
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
                                                onRowsRendered={handleRowsRendered}
                                                className="scrollbar-none"
                                                rowComponent={SidebarRow}
                                                rowProps={rowProps}
                                                style={{ height: height || 400, width: width || 260 }}
                                            />
                                        )}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer / Login */}
                    <div className="mt-auto border-t border-plum-700 p-4">
                        {user ? (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center shrink-0">
                                        <User className="h-4 w-4 text-brand-500" />
                                    </div>
                                    <span className="text-base text-zinc-300 truncate">
                                        {user.email}
                                    </span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Sign out"
                                    title="Sign out"
                                    className="h-8 w-8 text-zinc-500 hover:text-zinc-200"
                                    onClick={() => supabase.auth.signOut()}
                                >
                                    <LogOut className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <Link href="/login" className="flex items-center gap-3 px-3 py-2 text-zinc-400 hover:text-zinc-100 hover:bg-plum-700 rounded-lg transition-colors">
                                <LogIn className="h-5 w-5" />
                                <span className="text-base font-medium">Sign in</span>
                            </Link>
                        )}
                    </div>
                </div>
            </aside>

            {/* Floating Pill for Collapsed State */}
            <div
                className={cn(
                    'fixed top-3 left-3 z-[100] flex items-center gap-0.5 bg-plum-900/90 backdrop-blur-xl p-1.5 rounded-xl border border-brand-500/20 shadow-2xl shadow-brand-500/5 ring-1 ring-white/10',
                    'transition-all duration-200 ease-out',
                    isCollapsed ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-3 pointer-events-none'
                )}
            >
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Expand sidebar"
                    title="Expand sidebar"
                    onClick={expandSidebar}
                    className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-plum-700 transition-all rounded-lg"
                >
                    <PanelLeft className="h-5 w-5" />
                </Button>

                <div className="w-px h-4 bg-plum-700 mx-0.5" />

                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Search conversations"
                    title="Search conversations"
                    onClick={expandSidebar}
                    className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-plum-700 transition-all rounded-lg"
                >
                    <Search className="h-5 w-5" />
                </Button>

                <div className="w-px h-4 bg-plum-700 mx-0.5" />

                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="New chat"
                    title="New chat"
                    onClick={handleNewChat}
                    className="h-9 w-9 text-brand-500 hover:text-brand-400 hover:bg-brand-500/10 transition-all rounded-lg"
                >
                    <Plus className="h-5 w-5" />
                </Button>
            </div>

            {/* Delete confirmation modal */}
            <Dialog open={Boolean(deleteConfirm)} onOpenChange={(open) => { if (!open) handleDeleteCancel(); }}>
                <DialogContent>
                    <DialogTitle>
                            Confirm deletion
                    </DialogTitle>
                    <DialogDescription className="break-words">
                            Are you sure you want to delete <span className="text-zinc-300">&ldquo;{deleteConfirm?.title ?? ''}&rdquo;</span>? This action cannot be undone.
                    </DialogDescription>
                    <DialogFooter>
                            <Button
                                variant="ghost"
                                className="text-zinc-300 hover:text-zinc-100"
                                onClick={handleDeleteCancel}
                                disabled={deletePending}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleDeleteConfirm}
                                disabled={deletePending}
                            >
                                {deletePending ? 'Deleting...' : 'Confirm'}
                            </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
});

export { Sidebar };
