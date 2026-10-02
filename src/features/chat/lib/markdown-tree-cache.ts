import type { Root } from 'hast';

export type MarkdownEngine = 'worker' | 'main';

export interface CachedMarkdownTree {
    tree: Root;
    engine: MarkdownEngine;
}

interface CacheEntry extends CachedMarkdownTree {
    bytes: number;
}

/**
 * A small in-memory LRU for completed documents. The estimate includes both
 * the exact source key and the serialized HAST tree, using two bytes per
 * serialized UTF-16 code unit to stay conservative without another encoding
 * allocation.
 */
export class MarkdownTreeCache {
    private readonly entries = new Map<string, CacheEntry>();
    private readonly listeners = new Map<string, Set<() => void>>();
    private bytes = 0;

    constructor(
        readonly maxEntries = 40,
        readonly maxBytes = 8 * 1024 * 1024,
        readonly maxEntryBytes = 512 * 1024,
    ) {}

    get size() {
        return this.entries.size;
    }

    get byteSize() {
        return this.bytes;
    }

    getSnapshot(source: string): CachedMarkdownTree | null {
        const entry = this.entries.get(source);
        return entry ?? null;
    }

    set(source: string, snapshot: CachedMarkdownTree): boolean {
        let serialized: string | undefined;
        try {
            serialized = JSON.stringify({ source, tree: snapshot.tree });
        } catch {
            return false;
        }
        if (serialized === undefined) return false;
        const bytes = serialized.length * 2;
        const replacedExisting = this.deleteEntry(source, false);
        if (bytes > this.maxEntryBytes || bytes > this.maxBytes || this.maxEntries < 1) {
            if (replacedExisting) this.notify(source);
            return false;
        }

        this.entries.set(source, { ...snapshot, bytes });
        this.bytes += bytes;
        const evicted: string[] = [];
        while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
            const oldest = this.entries.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            if (this.deleteEntry(oldest, false)) evicted.push(oldest);
        }
        this.notify(source);
        for (const key of evicted) this.notify(key);
        return true;
    }

    touch(source: string): void {
        const entry = this.entries.get(source);
        if (!entry) return;
        this.entries.delete(source);
        this.entries.set(source, entry);
    }

    subscribe(source: string, listener: () => void): () => void {
        let sourceListeners = this.listeners.get(source);
        if (!sourceListeners) {
            sourceListeners = new Set();
            this.listeners.set(source, sourceListeners);
        }
        sourceListeners.add(listener);
        return () => {
            sourceListeners?.delete(listener);
            if (sourceListeners?.size === 0) this.listeners.delete(source);
        };
    }

    clear(): void {
        if (this.entries.size === 0) return;
        this.entries.clear();
        this.bytes = 0;
        for (const sourceListeners of this.listeners.values()) {
            for (const listener of sourceListeners) listener();
        }
    }

    private deleteEntry(source: string, notify: boolean): boolean {
        const entry = this.entries.get(source);
        if (!entry) return false;
        this.entries.delete(source);
        this.bytes -= entry.bytes;
        if (notify) this.notify(source);
        return true;
    }

    private notify(source: string): void {
        for (const listener of this.listeners.get(source) ?? []) listener();
    }
}

const markdownTreeCache = new MarkdownTreeCache();

export function subscribeMarkdownTreeCache(source: string, listener: () => void) {
    return markdownTreeCache.subscribe(source, listener);
}

export function getMarkdownTreeSnapshot(source: string) {
    return markdownTreeCache.getSnapshot(source);
}

export function cacheMarkdownTree(source: string, tree: Root, engine: MarkdownEngine) {
    return markdownTreeCache.set(source, { tree, engine });
}

export function touchMarkdownTree(source: string) {
    markdownTreeCache.touch(source);
}

/** Remove retained conversation Markdown when the authenticated account changes. */
function clearMarkdownCache() {
    markdownTreeCache.clear();
}

// The cache outlives mounted composers. Keep its account-change cleanup active
// even while a loading screen or error boundary has unmounted the draft hook.
if (typeof window !== 'undefined') {
    window.addEventListener('pluto:clear-markdown-cache', clearMarkdownCache);
}
