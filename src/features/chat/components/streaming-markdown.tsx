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

/**
 * During a stream we can render completed, standalone paragraphs once and keep
 * reparsing only the unfinished tail. Be deliberately conservative: block
 * syntax and reference links can depend on surrounding Markdown, so those
 * paragraphs stay in the live tail and are rendered together at completion.
 */
function takeFinalizedParagraphs(source: string): { blocks: string[]; consumed: number } {
    const blocks: string[] = [];
    let consumed = 0;
    const separator = /\n[ \t]*\n+/g;
    let match: RegExpExecArray | null;

    while ((match = separator.exec(source)) !== null) {
        const block = source.slice(consumed, match.index).trim();
        if (!block) {
            consumed = separator.lastIndex;
            continue;
        }
        // Freeze only single-line inline Markdown paragraphs. Fences, lists,
        // quotes, tables, headings, math, HTML, and cross-block references stay in tail.
        const hasBlockSyntax = /^(?:#{1,6}(?:\s|$)|>|[-*+]\s|\d+[.)]\s|```|~~~|\$\$)|\|.*\||\\\[|\\\(/.test(block);
        const hasCrossBlockSyntax = /\]\s*\[[^\]]*\]|\[\^[^\]]+\]|</.test(block);
        if (block.includes('\n') || hasBlockSyntax || hasCrossBlockSyntax) break;
        blocks.push(block);
        consumed = separator.lastIndex;
    }

    return { blocks, consumed };
}

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
    // Frozen paragraphs are rendered once as separate memoized Markdown trees;
    // only the unfinished tail is re-parsed as content streams in.
    const [frozenBlocks, setFrozenBlocks] = useState<string[]>([]);
    const [renderedTail, setRenderedTail] = useState(content);
    const processedLengthRef = useRef(0);
    const previousContentRef = useRef(content);

    // Refs to track latest values without re-triggering effects.
    const latestContentRef = useRef(content);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            setFrozenBlocks([]);
            setRenderedTail(content);
            processedLengthRef.current = content.length;
            previousContentRef.current = content;
            return;
        }

        if (!content.startsWith(previousContentRef.current)) {
            // A replacement/reset stream starts a fresh document.
            processedLengthRef.current = 0;
            setFrozenBlocks([]);
        }
        previousContentRef.current = content;

        // Streaming → schedule a debounced flush if one isn't already pending.
        if (timerRef.current === null) {
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                const latest = latestContentRef.current;
                const unprocessed = latest.slice(processedLengthRef.current);
                const finalized = takeFinalizedParagraphs(unprocessed);
                if (finalized.consumed > 0) {
                    processedLengthRef.current += finalized.consumed;
                    if (finalized.blocks.length > 0) {
                        setFrozenBlocks((previous) => [...previous, ...finalized.blocks]);
                    }
                }
                setRenderedTail(latest.slice(processedLengthRef.current));
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

    if (frozenBlocks.length === 0 && !renderedTail) return null;

    return (
        <div className={className}>
            {frozenBlocks.map((block, index) => (
                <MemoizedMarkdownRenderer
                    key={index}
                    content={block}
                    components={components ?? undefined}
                />
            ))}
            {renderedTail && (
                <MemoizedMarkdownRenderer
                    content={renderedTail}
                    components={components ?? undefined}
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
