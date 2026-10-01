'use client';

import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { getMarkdownPlugins } from '../lib/markdown-plugins';
import { isPlainMarkdownParagraph, takeFinalizedParagraphs } from '../lib/streaming-markdown-segments';

function preprocessLaTeX(text: string) {
    if (!text) return text;
    return text
        .replace(/\\+\[([\s\S]*?)\\+\]/g, (_, equation) => `\n$$\n${equation}\n$$\n`)
        .replace(/\\+\(([\s\S]*?)\\+\)/g, (_, equation) => `$${equation}$`);
}

// Regex to fix markdown headings without space after #.
const HEADING_FIX_REGEX = /^(#{1,6})([^#\s])/gm;

// Code/math markers used to lazy-load their stylesheets on demand instead of
// shipping katex + highlight.js CSS globally on every route.
const CODE_BLOCK_MARKER = /`{3,}|~{3,}|^(?: {4}|\t)/m;

/**
 * Injects the highlight.js and KaTeX stylesheets the first time rendered
 * content actually contains a code fence or math, respectively. Dynamic CSS
 * imports are deduped by the bundler module cache.
 */
function useLazyMarkdownStylesheets(content: string) {
    useEffect(() => {
        const preprocessed = preprocessLaTeX(content);
        const reportLoadError = (error: unknown) => {
            if (process.env.NODE_ENV !== 'production') console.warn('[markdown] Unable to load formatting styles', error);
        };
        if (CODE_BLOCK_MARKER.test(preprocessed)) {
            void import('highlight.js/styles/github-dark.css').catch(reportLoadError);
        }
        if (preprocessed.includes('$')) {
            void import('katex/dist/katex.min.css').catch(reportLoadError);
        }
    }, [content]);
}

/**
 * How often (ms) to re-parse markdown while streaming.
 * Lower = more responsive but heavier; higher = smoother but chunkier updates.
 */
const STREAMING_DEBOUNCE_MS = 45;
const LONG_MARKDOWN_TAIL_THRESHOLD = 8_000;
const LONG_MARKDOWN_DEBOUNCE_MS = 90;

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
    // Each timer batch becomes one frozen Markdown segment, while only the
    // unfinished tail is re-parsed as content streams in.
    const [frozenSegments, setFrozenSegments] = useState<string[]>([]);
    const [renderedTail, setRenderedTail] = useState(content);
    const [publishedSource, setPublishedSource] = useState(content);
    const processedLengthRef = useRef(0);
    const previousContentRef = useRef(content);

    // Refs to track latest values without re-triggering effects.
    const latestContentRef = useRef(content);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isReplacement = Boolean(isStreaming) && !content.startsWith(publishedSource);

    // The timer reads the latest committed content when it fires.
    useEffect(() => {
        latestContentRef.current = content;
    }, [content]);

    useLazyMarkdownStylesheets(isStreaming ? renderedTail : content);

    useEffect(() => {
        if (!isStreaming) {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            // At completion render the exact full document once, preserving
            // cross-block Markdown semantics such as reference definitions.
            setFrozenSegments([]);
            setRenderedTail(content);
            setPublishedSource(content);
            // A reasoning channel can resume after an answer part interleaves.
            // Keep its whole source available for the next streaming phase.
            processedLengthRef.current = 0;
            previousContentRef.current = content;
            return;
        }

        if (!content.startsWith(previousContentRef.current)) {
            // A replacement/reset stream starts a fresh document.
            processedLengthRef.current = 0;
            setFrozenSegments([]);
            setRenderedTail(content);
            setPublishedSource(content);
        }
        previousContentRef.current = content;

        // Streaming → schedule a debounced flush if one isn't already pending.
        if (timerRef.current === null) {
            const pendingTail = content.slice(processedLengthRef.current);
            const delay = pendingTail.length >= LONG_MARKDOWN_TAIL_THRESHOLD
                && !isPlainMarkdownParagraph(pendingTail)
                ? LONG_MARKDOWN_DEBOUNCE_MS
                : STREAMING_DEBOUNCE_MS;
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                const latest = latestContentRef.current;
                const unprocessed = latest.slice(processedLengthRef.current);
                const finalized = takeFinalizedParagraphs(unprocessed);
                if (finalized.consumed > 0) {
                    processedLengthRef.current += finalized.consumed;
                    if (finalized.blocks.length > 0) {
                        setFrozenSegments((previous) => [...previous, finalized.blocks.join('\n\n')]);
                    }
                }
                setRenderedTail(latest.slice(processedLengthRef.current));
                setPublishedSource(latest);
            }, delay);
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

    // Render the canonical complete document in the same commit that ends the
    // stream. Waiting for the effect below would briefly expose independently
    // parsed segments (which cannot share reference definitions).
    if (!isStreaming) {
        if (!content) return null;
        return (
            <div className={className}>
                <MemoizedMarkdownRenderer
                    content={content}
                    components={components ?? undefined}
                    isStreaming={false}
                />
            </div>
        );
    }

    // A replaced response must not show the previous answer while the debounce
    // timer waits to publish the new source.
    if (isReplacement) {
        return (
            <div className={className}>
                <MemoizedMarkdownRenderer
                    content={content}
                    components={components ?? undefined}
                    isStreaming
                />
            </div>
        );
    }

    // If the component mounted with an empty buffer, publish the first token
    // on the prop change instead of waiting for the first timer tick.
    if (content && frozenSegments.length === 0 && !renderedTail) {
        if (components?.p === undefined && isPlainMarkdownParagraph(content)) {
            return <div className={className}><p>{content}</p></div>;
        }
        return (
            <div className={className}>
                <MemoizedMarkdownRenderer
                    content={content}
                    components={components ?? undefined}
                    isStreaming
                />
            </div>
        );
    }

    if (frozenSegments.length === 0 && !renderedTail) return null;

    return (
        <div className={className}>
            {frozenSegments.map((segment, index) => (
                <MemoizedMarkdownRenderer
                    key={index}
                    content={segment}
                    components={components ?? undefined}
                    isStreaming={false}
                />
            ))}
            {renderedTail && components?.p === undefined && isPlainMarkdownParagraph(renderedTail)
                ? <p>{renderedTail}</p>
                : renderedTail && (
                    <MemoizedMarkdownRenderer
                        content={renderedTail}
                        components={components ?? undefined}
                        isStreaming={Boolean(isStreaming)}
                    />
                )}
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
    isStreaming,
}: {
    content: string;
    components?: Components;
    isStreaming: boolean;
}) {
    const markdown = preprocessLaTeX(content).replace(HEADING_FIX_REGEX, '$1 $2');
    const { remarkPlugins, rehypePlugins } = getMarkdownPlugins(markdown, isStreaming);

    return (
        <ReactMarkdown
            rehypePlugins={rehypePlugins}
            remarkPlugins={remarkPlugins}
            components={components}
        >
            {markdown}
        </ReactMarkdown>
    );
});

export const StreamingMarkdown = memo(StreamingMarkdownInner);
