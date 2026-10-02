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
    Pencil,
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
import { deleteThread, restoreThread, toggleThreadPin, updateThreadTitle } from '../lib/thread-mutations';
import { type Thread } from '@/shared/contracts/thread';
import { groupThreadsByDate } from '../lib/date-utils';
import { useDebouncedValue } from '@/shared/hooks/use-debounce';
import { cn } from '@/shared/core/utils';
import { useToast } from '@/components/ui/toast';
import { normalizeEditableThreadTitle } from '../lib/thread-model';
import { triggerNewChat } from '../lib/thread-events';

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
        try {
            return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
        } catch {
            return false;
        }
    });
    const [mobileOpen, setMobileOpen] = useState(false);
    const isCollapsed = isMobileSize ? !mobileOpen : desktopCollapsed;

    const [searchQuery, setSearchQuery] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<Thread | null>(null);
    const [editThread, setEditThread] = useState<Thread | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editPending, setEditPending] = useState(false);
    const [deletePending, setDeletePending] = useState(false);
    const deleteInFlightRef = useRef(false);
    const pinInFlightRef = useRef(new Set<string>());
    const signOutInFlightRef = useRef(false);
    const [hiddenDeletedThreadIds, setHiddenDeletedThreadIds] = useState<Set<string>>(() => new Set());
    const [user, setUser] = useState<SupabaseUser | null>(initialUser);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const mobileToggleRef = useRef<HTMLButtonElement>(null);
    const asideRef = useRef<HTMLElement>(null);
    const debouncedSearch = useDebouncedValue(searchQuery, 300);
    const {
        threads,
        loadMoreThreads,
        retryLoadMoreThreads,
        hasMoreThreads,
        isLoadingThreads,
        threadsError,
        loadMoreError,
        refreshThreads,
    } = useThreads(user?.id ?? null);
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
        error: searchError,
        paginationError: searchPaginationError,
        retrySearch,
        retryLoadMore: retryLoadMoreSearchThreads,
    } = useThreadSearch(user?.id ?? null, debouncedSearch);
    const visibleThreads = useMemo(
        () => (searching ? searchThreads : threads).filter((thread) => !hiddenDeletedThreadIds.has(thread.id)),
        [searching, searchThreads, threads, hiddenDeletedThreadIds]
    );
    const pinnedThreads = useMemo(() => visibleThreads.filter(t => t.is_pinned), [visibleThreads]);
    const unpinnedThreads = useMemo(() => visibleThreads.filter(t => !t.is_pinned), [visibleThreads]);
    const groupedThreads = useMemo(() => groupThreadsByDate(unpinnedThreads), [unpinnedThreads]);
    const firstPageError = searching ? searchError : threadsError;
    const olderPageError = searching ? searchPaginationError : loadMoreError;
    const isListLoading = searching ? isSearching : isLoadingThreads;
    const retryList = () => {
        if (searching) {
            if (searchError) retrySearch();
            else if (searchPaginationError) void retryLoadMoreSearchThreads();
        } else if (threadsError) {
            void refreshThreads();
        } else if (loadMoreError) {
            void retryLoadMoreThreads();
        }
    };
    const pathname = usePathname();
    const previousPathnameRef = useRef(pathname);
    const router = useRouter();
    const pathnameRef = useRef(pathname);
    pathnameRef.current = pathname;

    // Persist desktop collapsed state.
    useEffect(() => {
        try {
            window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(desktopCollapsed));
        } catch {
            // The sidebar remains usable when browser storage is unavailable.
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
            if (searching && hasMoreSearchThreads && !searchError && !searchPaginationError) void loadMoreSearchThreads();
            else if (!searching && hasMoreThreads && !threadsError && !isLoadingThreads && !loadMoreError) void loadMoreThreads();
        }
    }, [searching, hasMoreSearchThreads, searchError, searchPaginationError, loadMoreSearchThreads, hasMoreThreads, threadsError, isLoadingThreads, loadMoreError, loadMoreThreads, virtualItems.length]);

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
        if (pathname === '/') triggerNewChat();
        else router.push('/');
    }, [pathname, router]);

    const handleEditClick = useCallback((e: React.MouseEvent, thread: Thread) => {
        e.preventDefault();
        e.stopPropagation();
        setEditThread(thread);
        setEditTitle(thread.title);
    }, []);

    const handleEditSave = useCallback(async () => {
        if (!editThread || editPending) return;
        const normalizedTitle = normalizeEditableThreadTitle(editTitle);
        if (!normalizedTitle) {
            showToast('Enter a title before saving.', 'error');
            return;
        }
        setEditPending(true);
        try {
            await updateThreadTitle(editThread.id, normalizedTitle);
            setEditThread(null);
        } catch (error) {
            console.error('[Sidebar] Error updating thread title:', error);
            showToast('Failed to rename conversation', 'error');
        } finally {
            setEditPending(false);
        }
    }, [editThread, editPending, editTitle, showToast]);

    const handleDeleteClick = useCallback((e: React.MouseEvent, thread: Thread) => {
        try {
            e.preventDefault();
            e.stopPropagation();
            setDeleteConfirm(thread);
        } catch (err) {
            console.error('[Sidebar] Error in handleDeleteClick:', err);
        }
    }, []);

    const handleUndoDelete = useCallback(async (threadId: string, wasActive: boolean) => {
        try {
            await restoreThread(threadId);
            setHiddenDeletedThreadIds(previous => {
                const next = new Set(previous);
                next.delete(threadId);
                return next;
            });
            if (wasActive && pathnameRef.current === '/') router.push(`/c/${threadId}`);
            showToast('Conversation restored.', 'success');
        } catch (error) {
            console.error('[Sidebar] Error restoring conversation:', error);
            showToast('Undo is no longer available for this conversation.', 'error');
        }
    }, [router, showToast]);

    const handleDeleteConfirm = useCallback(async () => {
        if (!deleteConfirm || deleteInFlightRef.current) return;
        deleteInFlightRef.current = true;

        const threadId = deleteConfirm.id;
        const wasActive = pathname === `/c/${threadId}`;
        setHiddenDeletedThreadIds((previous) => new Set(previous).add(threadId));
        setDeletePending(true);
        if (wasActive) router.push('/');
        try {
            const deletion = await deleteThread(threadId);
            window.dispatchEvent(new CustomEvent('pluto:thread-deleted'));
            setDeleteConfirm(null);
            const undoRemainingMs = Date.parse(deletion.undo_until) - Date.now();
            showToast('Conversation deleted.', 'info', {
                ...(Number.isFinite(undoRemainingMs) && undoRemainingMs > 0
                    ? {
                        durationMs: undoRemainingMs,
                        action: { label: 'Undo', onClick: () => { void handleUndoDelete(threadId, wasActive); } },
                    }
                    : {}),
            });
        } catch (err) {
            setHiddenDeletedThreadIds((previous) => {
                const next = new Set(previous);
                next.delete(threadId);
                return next;
            });
            setDeleteConfirm(null);
            if (wasActive) router.push(`/c/${threadId}`);
            console.error('[Sidebar] Error in handleDeleteConfirm:', err);
            showToast('Failed to delete thread', 'error');
        } finally {
            deleteInFlightRef.current = false;
            setDeletePending(false);
        }
    }, [deleteConfirm, pathname, router, showToast, handleUndoDelete]);

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

    useEffect(() => {
        if (!isMobileSize || !mobileOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return () => { document.body.style.overflow = previousOverflow; };
    }, [isMobileSize, mobileOpen]);

    useEffect(() => {
        if (!isMobileSize || mobileOpen) return;
        requestAnimationFrame(() => mobileToggleRef.current?.focus());
    }, [isMobileSize, mobileOpen]);

    useEffect(() => {
        if (!isMobileSize || !mobileOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (deleteConfirm || editThread) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                setMobileOpen(false);
                return;
            }
            if (event.key === 'Tab' && asideRef.current) {
                const focusable = asideRef.current.querySelectorAll<HTMLElement>(
                    'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
                );
                const first = focusable.item(0);
                const last = focusable.item(focusable.length - 1);
                if (!first || !last) return;
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isMobileSize, mobileOpen, deleteConfirm, editThread]);

    useEffect(() => {
        if (previousPathnameRef.current === pathname) return;
        previousPathnameRef.current = pathname;
        if (isMobileSize) setMobileOpen(false);
    }, [pathname, isMobileSize]);

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
                    <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        aria-label={`Rename ${thread.title}`}
                        title="Rename conversation"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md"
                        onClick={(e) => handleEditClick(e, thread)}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
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
    }, [pathname, handleTogglePin, handleDeleteClick, handleEditClick]);

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
                ref={asideRef}
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
                role={isMobileSize && mobileOpen ? 'dialog' : 'navigation'}
                aria-label={isMobileSize && mobileOpen ? 'Conversation navigation' : 'Conversation sidebar'}
                aria-modal={isMobileSize && mobileOpen ? true : undefined}
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
                                ref={searchInputRef}
                                type="text"
                                aria-label="Search conversations"
                                placeholder="Search conversations..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-base text-foreground shadow-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0"
                            />
                        </div>
                    </div>

                    {/* Chat List */}
                    <div className="flex min-h-0 flex-1 flex-col">
                        {virtualItems.length > 0 && (firstPageError || olderPageError) && (
                            <div role="alert" className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-foreground">
                                <span>{firstPageError ?? olderPageError}</span>
                                <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2" onClick={retryList}>Retry</Button>
                            </div>
                        )}
                        <div className="min-h-0 flex-1">
                          <div className="h-full w-full relative px-2">
                            {virtualItems.length === 0 ? (
                                <div className="text-center py-12">
                                    <div className="mx-auto max-w-[210px] whitespace-normal break-words px-3 py-12 text-center">
                                        <p className="text-sm font-medium text-sidebar-foreground">
                                            {firstPageError ? (searching ? 'Search failed' : 'Could not load conversations') : isListLoading ? (searching ? 'Searching conversations…' : 'Loading conversations…') : searching ? 'No matching conversations' : user ? 'Your conversations will appear here' : 'Sign in to save conversations'}
                                        </p>
                                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                            {firstPageError ? (searching ? 'Check your connection and try the search again.' : 'Check your connection and try loading conversations again.') : searching ? `Try another title or clear “${debouncedSearch.trim()}”.` : user ? 'Start a new chat and it will be easy to find here.' : 'You can start chatting now, then sign in to keep your history.'}
                                        </p>
                                        {firstPageError && (
                                            <Button variant="ghost" size="sm" className="mt-3 h-8" onClick={retryList}>Retry</Button>
                                        )}
                                        {!firstPageError && !isListLoading && searching && (
                                            <Button variant="ghost" size="sm" className="mt-3 h-8" onClick={() => setSearchQuery('')}>
                                                Clear search
                                            </Button>
                                        )}
                                    </div>
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
                    'fixed top-3 left-3 z-40 flex items-center gap-0.5 bg-popover/95 text-popover-foreground backdrop-blur-xl p-1.5 rounded-xl border border-border shadow-xl shadow-black/20',
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
                    ref={mobileToggleRef}
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

            <Dialog open={Boolean(editThread)} onOpenChange={(open) => { if (!open && !editPending) setEditThread(null); }}>
                <DialogContent>
                    <DialogTitle>Rename conversation</DialogTitle>
                    <DialogDescription>Choose a title that will help you find this conversation later.</DialogDescription>
                    <Input
                        autoFocus
                        aria-label="Conversation title"
                        value={editTitle}
                        maxLength={80}
                        onChange={(event) => setEditTitle(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') void handleEditSave(); }}
                        disabled={editPending}
                    />
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setEditThread(null)} disabled={editPending}>Cancel</Button>
                        <Button onClick={() => void handleEditSave()} disabled={editPending || !editTitle.trim()}>
                            {editPending ? 'Saving…' : 'Save title'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
});

export { Sidebar };
