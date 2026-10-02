'use client';

import { Loader2, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createMessageSearchSnippet } from '../lib/message-search';
import { useMessageSearch, type MessageSearchResult } from '../hooks/use-message-search';
import { Button } from '@/components/ui/button';

interface MessageSearchDialogProps {
    threadId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelectMessage: (messageId: string) => void;
    jumpingMessageId?: string | null;
}

export function MessageSearchDialog({ threadId, open, onOpenChange, onSelectMessage, jumpingMessageId }: MessageSearchDialogProps) {
    const { query, setQuery, results, loading, error, retry } = useMessageSearch(threadId, open);
    const term = query.trim();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl gap-3">
                <DialogTitle>Search this conversation</DialogTitle>
                <DialogDescription>Find text in every message, including messages that are not loaded yet.</DialogDescription>
                <div className="flex items-center gap-2 rounded-lg border border-input px-3 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50">
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <Input
                        autoFocus
                        aria-label="Search messages"
                        placeholder="Search messages…"
                        maxLength={256}
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        className="h-11 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                    />
                    {query && (
                        <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="rounded p-1 text-muted-foreground hover:text-foreground">
                            <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                    )}
                </div>
                <div className="max-h-[55dvh] min-h-20 overflow-y-auto" aria-live="polite">
                    {term.length < 2 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">Enter at least two characters to search.</p>
                    ) : loading ? (
                        <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Searching messages…
                        </p>
                    ) : error ? (
                        <div className="flex flex-col items-center gap-2 py-6 text-center">
                            <p role="alert" className="text-sm text-destructive">{error}</p>
                            <Button type="button" variant="outline" size="sm" onClick={retry}>Retry search</Button>
                        </div>
                    ) : results.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">No messages match “{term}”.</p>
                    ) : (
                        <ul className="space-y-1">
                            {results.map((message: MessageSearchResult) => (
                                <li key={message.id}>
                                    <button
                                        type="button"
                                        disabled={Boolean(jumpingMessageId)}
                                        onClick={() => onSelectMessage(message.id)}
                                        className="w-full rounded-lg border border-transparent px-3 py-3 text-left hover:border-border hover:bg-accent disabled:opacity-60"
                                        aria-label={`Jump to ${message.role} message: ${createMessageSearchSnippet(message.content, term)}`}
                                    >
                                        <span className="flex items-center justify-between gap-3">
                                            <span className="text-xs font-medium capitalize text-muted-foreground">{message.role} message</span>
                                            {jumpingMessageId === message.id && <span role="status" className="text-xs text-muted-foreground">Loading message…</span>}
                                            <time className="text-xs text-muted-foreground">{new Date(message.created_at).toLocaleString()}</time>
                                        </span>
                                        <span className="mt-1 block whitespace-normal break-words text-sm text-foreground">
                                            {createMessageSearchSnippet(message.content, term)}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                {!loading && !error && results.length === 20 && (
                    <p className="text-center text-xs text-muted-foreground">
                        Showing the latest 20 matches. Refine your search to find older messages.
                    </p>
                )}
            </DialogContent>
        </Dialog>
    );
}
