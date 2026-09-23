'use client';

import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

function preprocessLaTeX(text: string) {
    if (!text) return text;
    return text
        .replace(/\\+\[([\s\S]*?)\\+\]/g, (_, equation) => `\n$$\n${equation}\n$$\n`)
        .replace(/\\+\(([\s\S]*?)\\+\)/g, (_, equation) => `$${equation}$`);
}

const REHYPE_PLUGINS = [rehypeHighlight, rehypeKatex];
const REMARK_PLUGINS = [remarkGfm, remarkMath];

// Regex to fix markdown headings without space after #.
const HEADING_FIX_REGEX = /^(#{1,6})([^#\s])/gm;

// Code/math markers used to lazy-load their stylesheets on demand instead of
// shipping katex + highlight.js CSS globally on every route.
const CODE_BLOCK_MARKER = /```/;
const MATH_MARKER = /\$\$|\$[^\s$]/;

/**
 * Injects the highlight.js and KaTeX stylesheets the first time rendered
 * content actually contains a code fence or math, respectively. Dynamic CSS
 * imports are deduped by the bundler module cache.
 */
function useLazyMarkdownStylesheets(content: string) {
    useEffect(() => {
        const preprocessed = preprocessLaTeX(content);
        if (CODE_BLOCK_MARKER.test(preprocessed)) {
            void import('highlight.js/styles/github-dark.css');
        }
        if (MATH_MARKER.test(preprocessed)) {
            void import('katex/dist/katex.min.css');
        }
    }, [content]);
}

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

    // The timer reads the latest committed content when it fires.
    useEffect(() => {
        latestContentRef.current = content;
    }, [content]);

    useLazyMarkdownStylesheets(renderedContent);

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

    }, [content, isStreaming]);

    // A new chunk must not cancel the timer for the previous chunk.
    useEffect(() => {
        return () => {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, []);

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
            {preprocessLaTeX(content).replace(HEADING_FIX_REGEX, '$1 $2')}
        </ReactMarkdown>
    );
});

export const StreamingMarkdown = memo(StreamingMarkdownInner);
