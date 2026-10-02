'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import type { Components } from 'react-markdown';
import type { Root } from 'hast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { markdownWorker } from '../lib/markdown-worker-client';
import {
    cacheMarkdownTree,
    getMarkdownTreeSnapshot,
    subscribeMarkdownTreeCache,
    touchMarkdownTree,
} from '../lib/markdown-tree-cache';

interface ParsedMarkdown {
    content: string;
    isStreaming: boolean;
    tree: Root;
    engine: 'worker' | 'main';
}

const getServerMarkdownSnapshot = () => null;

function cloneMarkdownTree(tree: Root): Root {
    if (typeof structuredClone === 'function') return structuredClone(tree);
    return JSON.parse(JSON.stringify(tree)) as Root;
}

export const WorkerMarkdown = memo(function WorkerMarkdown({ content, components, isStreaming }: {
    content: string;
    components?: Components;
    isStreaming: boolean;
}) {
    const [parsed, setParsed] = useState<ParsedMarkdown | null>(null);
    const currentSourceRef = useRef({ content, isStreaming });
    useLayoutEffect(() => {
        currentSourceRef.current = { content, isStreaming };
    }, [content, isStreaming]);
    const subscribe = useCallback((listener: () => void) => subscribeMarkdownTreeCache(content, listener), [content]);
    const getSnapshot = useCallback(() => getMarkdownTreeSnapshot(content), [content]);
    const cached = useSyncExternalStore(subscribe, getSnapshot, getServerMarkdownSnapshot);
    useEffect(() => {
        if (!isStreaming && cached) {
            touchMarkdownTree(content);
            return;
        }
        const controller = new AbortController();
        const isCurrent = () => !controller.signal.aborted
            && currentSourceRef.current.content === content
            && currentSourceRef.current.isStreaming === isStreaming;
        const publish = (tree: Root, engine: ParsedMarkdown['engine']) => {
            if (!isCurrent()) return;
            if (!isStreaming) cacheMarkdownTree(content, tree, engine);
            setParsed({ content, isStreaming, tree, engine });
        };
        void markdownWorker.parse(content, isStreaming, controller.signal)
            .then(tree => publish(tree, 'worker'))
            .catch(async () => {
                if (!isCurrent()) return;
                try {
                    // The heavy parser stays out of the normal UI bundle.
                    const { parseMarkdown } = await import('../lib/markdown-parser');
                    if (isCurrent()) publish(parseMarkdown(content, isStreaming), 'main');
                } catch {
                    // Keep source readable if formatting itself fails.
                }
            });
        return () => controller.abort();
    }, [content, isStreaming, cached]);

    // Retain a rendered prefix during appends, but never show a previous reply
    // during replacement/reset. SSR and initial hydration share the same source.
    const visible = !isStreaming && cached
        ? { content, isStreaming: false, ...cached }
        : parsed && content.startsWith(parsed.content) ? parsed : null;
    const visibleTree = visible?.tree;
    const runtimeTree = useMemo(() => visibleTree ? cloneMarkdownTree(visibleTree) : null, [visibleTree]);
    const ready = visible?.content === content && visible.isStreaming === isStreaming;
    return <div className={visible ? 'contents' : 'whitespace-pre-wrap'}
        data-markdown-state={ready ? 'ready' : 'pending'} data-markdown-engine={visible?.engine}>
        {visible && runtimeTree ? toJsxRuntime(runtimeTree, {
            Fragment, jsx, jsxs, components, ignoreInvalidStyle: true, passKeys: true, passNode: true,
        }) : content}
    </div>;
});
