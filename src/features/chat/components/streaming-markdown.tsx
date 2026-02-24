'use client';

import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { preprocessLaTeX } from '@/features/chat/lib/latex-utils';

const REHYPE_PLUGINS = [rehypeHighlight, rehypeKatex];
const REMARK_PLUGINS = [remarkGfm, remarkMath];

/**
 * How often (ms) to re-parse markdown while streaming.
 * Lower = more responsive but heavier; higher = smoother but chunkier updates.
 */
const STREAMING_DEBOUNCE_MS = 120;

interface StreamingMarkdownProps {
    /** Raw markdown text (may grow on every frame during streaming). */
    content: string;
    /** Whether the content is currently being streamed. */
    isStreaming?: boolean;
    /** Extra className for the wrapper div. */
    className?: string;
    /** Custom component overrides for ReactMarkdown. */
    components?: Components | null;
}

/**
 * A debounced + memoized markdown renderer for streaming content.
 *
 * During streaming:
 *   - Updates the rendered markdown at most every STREAMING_DEBOUNCE_MS.
 *   - Incoming content changes between debounce intervals are batched.
 *   - When streaming ends the final content is flushed immediately.
 *
 * When not streaming:
 *   - Renders synchronously (no debounce) and benefits from React.memo
 *     skipping re-renders when content is unchanged.
 */
function StreamingMarkdownInner({
    content,
    isStreaming,
    className,
    components,
}: StreamingMarkdownProps) {
    // `renderedContent` is what ReactMarkdown actually receives.
    // During streaming it lags behind `content` by up to STREAMING_DEBOUNCE_MS.
    const [renderedContent, setRenderedContent] = useState(content);

    // Refs to track latest values without re-triggering effects.
    const latestContentRef = useRef(content);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Always keep the ref in sync with the prop.
    latestContentRef.current = content;

    useEffect(() => {
        if (!isStreaming) {
            // Not streaming → flush immediately and clear any pending timer.
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            setRenderedContent(content);
            return;
        }

        // Streaming → schedule a debounced flush if one isn't already pending.
        if (timerRef.current === null) {
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                setRenderedContent(latestContentRef.current);
            }, STREAMING_DEBOUNCE_MS);
        }

        // Cleanup on unmount or when streaming stops.
        return () => {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [content, isStreaming]);

    if (!renderedContent) return null;

    return (
        <div className={className}>
            <MemoizedMarkdownRenderer
                content={renderedContent}
                components={components ?? undefined}
            />
        </div>
    );
}

/**
 * The actual ReactMarkdown call, wrapped in React.memo so it only re-renders
 * when `content` (the debounced value) changes.
 */
const MemoizedMarkdownRenderer = memo(function MemoizedMarkdownRenderer({
    content,
    components,
}: {
    content: string;
    components?: Components;
}) {
    return (
        <ReactMarkdown
            rehypePlugins={REHYPE_PLUGINS}
            remarkPlugins={REMARK_PLUGINS}
            components={components}
        >
            {preprocessLaTeX(content)}
        </ReactMarkdown>
    );
});

export const StreamingMarkdown = memo(StreamingMarkdownInner);
