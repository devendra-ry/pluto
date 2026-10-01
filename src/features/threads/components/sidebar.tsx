'use client';

import { useState, useEffect, useMemo, useRef, memo, useCallback } from 'react';
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
import { useThreadSearch } from '../hooks/use-thread-search';
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
                <h3 className="text-sm font-semibold text-muted-foreground px-4 py-2 mt-4 mb-1 first:mt-0">
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
    const deleteInFlightRef = useRef(false);
    const pinInFlightRef = useRef(new Set<string>());
    const signOutInFlightRef = useRef(false);
    const [hiddenDeletedThreadIds, setHiddenDeletedThreadIds] = useState<Set<string>>(() => new Set());
    const [user, setUser] = useState<SupabaseUser | null>(initialUser);
    const debouncedSearch = useDebouncedValue(searchQuery, 300);
    const { threads, loadMoreThreads, hasMoreThreads } = useThreads(user?.id ?? null);
    const { showToast } = useToast();

    const [supabase] = useState(() => createClient());

    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, [supabase]);

    const searching = debouncedSearch.trim().length > 0;
    const {
        threads: searchThreads,
        hasMore: hasMoreSearchThreads,
        loading: isSearching,
        loadMore: loadMoreSearchThreads,
    } = useThreadSearch(user?.id ?? null, debouncedSearch);
    const visibleThreads = useMemo(
        () => (searching ? searchThreads : threads).filter((thread) => !hiddenDeletedThreadIds.has(thread.id)),
        [searching, searchThreads, threads, hiddenDeletedThreadIds]
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

    // Flatten filtered threads and headers into items for virtualization
    const virtualItems = useMemo(() => {
        const items: VirtualItem[] = [];

        if (pinnedThreads.length > 0) {
            items.push({ type: 'header', label: 'Pinned' });
            pinnedThreads.forEach(t => items.push({ type: 'thread', data: t }));
        }

        groupedThreads.forEach(group => {
            items.push({ type: 'header', label: group.label });
            group.threads.forEach(t => items.push({ type: 'thread', data: t }));
        });

        return items;
    }, [pinnedThreads, groupedThreads]);

    const handleRowsRendered = useCallback(({ stopIndex }: { startIndex: number; stopIndex: number }) => {
        if (stopIndex >= Math.max(0, virtualItems.length - 12)) {
            if (searching && hasMoreSearchThreads) void loadMoreSearchThreads();
            else if (!searching && hasMoreThreads) void loadMoreThreads();
        }
    }, [searching, hasMoreSearchThreads, loadMoreSearchThreads, hasMoreThreads, loadMoreThreads, virtualItems.length]);

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
        if (!deleteConfirm || deleteInFlightRef.current) return;
        deleteInFlightRef.current = true;

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
            deleteInFlightRef.current = false;
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
        e.preventDefault();
        e.stopPropagation();
        if (pinInFlightRef.current.has(threadId)) return;
        pinInFlightRef.current.add(threadId);
        try {
            await toggleThreadPin(threadId, !isPinned);
        } catch (err) {
            console.error('[Sidebar] Error in handleTogglePin:', err);
            showToast('Failed to update pin status', 'error');
        } finally {
            pinInFlightRef.current.delete(threadId);
        }
    }, [showToast]);

    const handleSignOut = useCallback(async () => {
        if (signOutInFlightRef.current) return;
        signOutInFlightRef.current = true;
        try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
        } catch (error) {
            console.error('[Sidebar] Failed to sign out:', error);
            showToast('Unable to sign out. Please try again.', 'error');
        } finally {
            signOutInFlightRef.current = false;
        }
    }, [supabase, showToast]);


    const renderThreadItem = useCallback((thread: Thread) => {
        const isActive = pathname === `/c/${thread.id}`;

        return (
            <div
                className={cn(
                    "group relative rounded-lg transition-colors",
                    isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent"
                )}
            >
                <Link
                    href={`/c/${thread.id}`}
                    className={cn(
                        'flex items-center gap-2 px-3 py-2 text-sm transition-all rounded-lg outline-none min-w-0 relative overflow-hidden',
                        isActive
                            ? 'text-sidebar-accent-foreground font-medium'
                            : 'text-sidebar-foreground/75 group-hover:text-sidebar-foreground'
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
                    className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity duration-200 h-full pr-1 z-10"
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
                                thread.is_pinned ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                            )}
                            onClick={(e) => handleTogglePin(e, thread.id, !!thread.is_pinned)}
                        >
                            <Pin className={cn("h-3.5 w-3.5 transform rotate-45", thread.is_pinned && "fill-current")} />
                        </Button>
                        <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-popover text-popover-foreground border border-border text-[10px] rounded whitespace-nowrap opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity z-50">
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
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            onClick={(e) => handleDeleteClick(e, thread)}
                        >
                            <X className="h-3.5 w-3.5" />
                        </Button>
                        <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-popover text-popover-foreground border border-border text-[10px] rounded whitespace-nowrap opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity z-50">
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
                    aria-hidden="true"
                    className={cn(
                        'fixed inset-0 bg-black/60 backdrop-blur-sm z-30 transition-opacity duration-[var(--motion-duration-slow,420ms)] ease-[var(--motion-ease,cubic-bezier(0.22,1,0.36,1))]',
                        isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                    )}
                />
            )}

            {/* Animated Sidebar */}
            <aside
                className={cn(
                    'h-dvh flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border overflow-hidden whitespace-nowrap z-40 border-r',
                    isMobileSize
                        ? 'fixed left-0 top-0 w-[260px] shadow-2xl transition-[transform,opacity] duration-[var(--motion-duration-slow,420ms)] ease-[var(--motion-ease,cubic-bezier(0.22,1,0.36,1))]'
                        : 'relative transition-[width,opacity] duration-[var(--motion-duration-slow,420ms)] ease-[var(--motion-ease,cubic-bezier(0.22,1,0.36,1))]',
                    isMobileSize
                        ? (isCollapsed ? '-translate-x-full opacity-0' : 'translate-x-0 opacity-100')
                        : (isCollapsed ? 'w-0 opacity-0 border-r-0' : 'w-[260px] opacity-100')
                )}
                aria-hidden={isCollapsed}
                inert={isCollapsed}
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
                            className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                        >
                            <PanelLeftClose className="h-5 w-5" />
                        </Button>
                        <span className="font-bold text-sidebar-foreground text-2xl px-1">Pluto</span>
                        <div className="w-9" />
                    </div>

                    {/* New Chat Button */}
                    <div className="px-3 pb-2 pt-2">
                        <Button
                            onClick={handleNewChat}
                            className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring font-medium rounded-lg shadow-sm text-sm transition-colors"
                        >
                            New Chat
                        </Button>
                    </div>

                    {/* Search */}
                    <div className="px-3 pb-4">
                        <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground group bg-background rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50">
                            <Search className="h-5 w-5 text-muted-foreground group-focus-within:text-foreground transition-colors shrink-0" />
                            <Input
                                type="text"
                                placeholder="Search conversations..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-base text-foreground shadow-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0"
                            />
                        </div>
                    </div>

                    {/* Chat List */}
                    <div className="flex-1 min-h-0">
                        <div className="h-full w-full relative px-2">
                            {virtualItems.length === 0 ? (
                                <div className="text-center py-12">
                                    <p className="text-sm text-muted-foreground">
                                        {searching && isSearching ? 'Searching...' : searching ? 'No results found' : 'No conversations yet'}
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
                    <div className="mt-auto border-t border-sidebar-border p-4">
                        {user ? (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                        <User className="h-4 w-4 text-primary" />
                                    </div>
                                    <span className="text-sm text-sidebar-foreground truncate">
                                        {user.email}
                                    </span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Sign out"
                                    title="Sign out"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                                    onClick={handleSignOut}
                                >
                                    <LogOut className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <Link href="/login" className="flex items-center gap-3 px-3 py-2 text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
                    'fixed top-3 left-3 z-[100] flex items-center gap-0.5 bg-popover/95 text-popover-foreground backdrop-blur-xl p-1.5 rounded-xl border border-border shadow-xl shadow-black/20',
                    'transition-[opacity,transform] duration-[var(--motion-duration-slow,420ms)] ease-[var(--motion-ease,cubic-bezier(0.22,1,0.36,1))]',
                    isCollapsed ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-3 pointer-events-none'
                )}
                aria-hidden={!isCollapsed}
                inert={!isCollapsed}
            >
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Expand sidebar"
                    title="Expand sidebar"
                    onClick={expandSidebar}
                    className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors rounded-lg"
                >
                    <PanelLeft className="h-5 w-5" />
                </Button>

                <div className="w-px h-4 bg-border mx-0.5" />

                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Search conversations"
                    title="Search conversations"
                    onClick={expandSidebar}
                    className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors rounded-lg"
                >
                    <Search className="h-5 w-5" />
                </Button>

                <div className="w-px h-4 bg-border mx-0.5" />

                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="New chat"
                    title="New chat"
                    onClick={handleNewChat}
                    className="h-9 w-9 text-primary hover:text-primary hover:bg-primary/10 transition-colors rounded-lg"
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
                            Are you sure you want to delete <span className="text-foreground">&ldquo;{deleteConfirm?.title ?? ''}&rdquo;</span>? This action cannot be undone.
                    </DialogDescription>
                    <DialogFooter>
                            <Button
                                variant="ghost"
                                className="text-muted-foreground hover:text-foreground"
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
