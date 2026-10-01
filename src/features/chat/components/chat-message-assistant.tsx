'use client';

import Image from 'next/image';
import { Copy, RefreshCcw, GitBranch, ChevronDown, Check, Brain, Loader2 } from 'lucide-react';
import { useCallback, useId, useState, type ComponentProps } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FLUID_TRANSITION } from '@/shared/lib/motion';
import ReactMarkdown from 'react-markdown';
import { useCopyToClipboard } from '@/shared/hooks/use-copy-to-clipboard';
import { cn } from '@/shared/core/utils';
import { type Attachment } from '@/shared/core/types';
import { isLegacyAttachmentProxyUrl } from '@/features/attachments';
import type { ChatResponseStats } from '@/shared/core/types';
import { ActionIcon } from './chat-action-icon';
import { StreamingMarkdown } from './streaming-markdown';
import { useClearCommittedStream, useStreamedMessageSelector, type StreamedMessageSnapshot } from './chat-stream-message-store';

const selectContent = (snapshot: StreamedMessageSnapshot) => snapshot.content;
const selectReasoningPresence = (snapshot: StreamedMessageSnapshot) => Boolean(snapshot.reasoning);
const selectStats = (snapshot: StreamedMessageSnapshot) => snapshot.stats;

const MARKDOWN_COMPONENTS: ComponentProps<typeof ReactMarkdown>['components'] = {
    pre: ({ children }) => (
        <pre className="bg-popover backdrop-blur-sm rounded-xl p-5 overflow-x-auto my-4 border border-border scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
            {children}
        </pre>
    ),
    code: ({ className, children, ...props }) => {
        const isInline = !className;
        return isInline ? (
            <code className="bg-accent px-1.5 py-0.5 rounded-md text-[15px] text-brand-300 font-mono border border-border" {...props}>
                {children}
            </code>
        ) : (
            <code className={cn(className, "font-mono text-[15px] leading-relaxed")} {...props}>
                {children}
            </code>
        );
    },
    li: ({ children }) => (
        <li className="text-foreground my-1">{children}</li>
    ),
    table: ({ children }) => (
        <div className="my-4 max-w-full overflow-x-auto">
            <table className="w-max min-w-full">{children}</table>
        </div>
    ),
};

interface AssistantMessageProps {
    id: string;
    content: string;
    attachments?: Attachment[];
    isStreaming?: boolean;
    isThinking?: boolean;
    modelName?: string;
    reasoning?: string;
    stats?: ChatResponseStats;
    onRetry?: (id: string) => void;
    onBranch?: (id: string) => void;
}

export function AssistantMessage({
    id,
    content,
    attachments = [],
    isStreaming,
    isThinking,
    modelName,
    reasoning,
    stats,
    onRetry,
    onBranch,
}: AssistantMessageProps) {
    // Collapsed by default
    const [reasoningExpanded, setReasoningExpanded] = useState(false);
    const { copied, copy } = useCopyToClipboard();
    const reduceMotion = useReducedMotion();
    const reasoningPanelId = useId();
    const selectVisibleReasoning = useCallback((snapshot: StreamedMessageSnapshot) => reasoningExpanded ? snapshot.reasoning : '', [reasoningExpanded]);
    const streamedContent = useStreamedMessageSelector(id, selectContent);
    const streamedReasoning = useStreamedMessageSelector(id, selectVisibleReasoning);
    const hasStreamedReasoning = useStreamedMessageSelector(id, selectReasoningPresence);
    const streamedStats = useStreamedMessageSelector(id, selectStats);
    const renderedContent = streamedContent || content;
    const renderedReasoning = streamedReasoning || reasoning;
    const hasReasoning = hasStreamedReasoning || Boolean(reasoning);
    const renderedStats = streamedStats ?? stats;
    useClearCommittedStream(id, isStreaming, content, reasoning);

    const handleCopy = () => copy(renderedContent);

    // Don't return null if streaming (loading) - show loading indicator
    if (!renderedContent && !hasReasoning && attachments.length === 0 && !isThinking && !isStreaming) return null;

    // Show loading indicator for non-thinking models when streaming but no content yet
    const showLoadingDots = isStreaming && !renderedContent && !hasReasoning && attachments.length === 0 && !isThinking;
    const formattedStats = renderedStats
        ? {
            outputTokens: Math.max(0, Math.round(renderedStats.outputTokens + (renderedStats.reasoningTokens ?? 0))),
            reasoningTokens: typeof renderedStats.reasoningTokens === 'number' ? Math.max(0, Math.round(renderedStats.reasoningTokens)) : null,
            seconds: Number(renderedStats.seconds.toFixed(1)),
            tokensPerSecond: Number(renderedStats.tokensPerSecond.toFixed(1)),
            ttfbSeconds: typeof renderedStats.ttfbSeconds === 'number' ? Number(renderedStats.ttfbSeconds.toFixed(1)) : null,
            source: renderedStats.source ?? 'estimated',
        }
        : null;

    return (
        <div className="py-1 px-4 group" aria-busy={Boolean(isStreaming)}>
            <div className="max-w-3xl">
                {/* Loading indicator for non-thinking models */}
                {showLoadingDots && (
                    <div className="flex items-center gap-1.5 h-6 py-4">
                        <span className="w-2 h-2 rounded-full bg-muted-foreground thinking-dot [animation-delay:-0.3s]" />
                        <span className="w-2 h-2 rounded-full bg-muted-foreground thinking-dot [animation-delay:-0.15s]" />
                        <span className="w-2 h-2 rounded-full bg-muted-foreground thinking-dot" />
                    </div>
                )}

                {/* Reasoning section (collapsible) */}
                {(hasReasoning || isThinking) && (
                    <div className="mb-4">
                        <div
                            className={cn(
                                "rounded-xl transition-[background-color,border-color,box-shadow] duration-300 ease-fluid overflow-hidden border",
                                reasoningExpanded
                                    ? "bg-popover border-border shadow-xl"
                                    : "bg-transparent border-transparent"
                            )}
                        >
                            <button
                                type="button"
                                aria-expanded={reasoningExpanded}
                                aria-controls={reasoningPanelId}
                                onClick={() => setReasoningExpanded(!reasoningExpanded)}
                                className={cn(
                                    "flex items-center gap-1.5 transition-colors px-0 py-2",
                                    reasoningExpanded ? "border-b border-border bg-secondary -mx-3 px-3 w-[calc(100%+1.5rem)]" : ""
                                )}
                            >
                                <Brain className={cn(
                                    "h-4 w-4 shrink-0 transition-colors",
                                    reasoningExpanded ? "text-brand-400/80" : "text-muted-foreground"
                                )} />
                                <span className="text-sm font-medium tracking-tight text-muted-foreground">Reasoning</span>
                                <ChevronDown className={cn(
                                    "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-300 ease-fluid",
                                    reasoningExpanded && "rotate-180"
                                )} />
                                {isThinking && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0 ml-1" />}
                            </button>

                            <AnimatePresence initial={false}>
                                {reasoningExpanded && <motion.div
                                    key="reasoning"
                                    id={reasoningPanelId}
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={reduceMotion ? { duration: 0 } : FLUID_TRANSITION}
                                    className="overflow-hidden"
                                >
                                    <div className="overflow-hidden">
                                        <div className="p-4 pt-1">
                                            {renderedReasoning ? (
                                                <StreamingMarkdown
                                                    content={renderedReasoning}
                                                    isStreaming={Boolean(isThinking)}
                                                    className="prose prose-invert prose-base max-w-none
                                                        prose-p:text-muted-foreground prose-p:leading-relaxed prose-p:text-[15px] prose-p:my-3
                                                        prose-li:text-[15px] prose-li:text-muted-foreground
                                                        prose-headings:text-foreground prose-headings:font-semibold
                                                        prose-strong:text-foreground
                                                        prose-blockquote:text-muted-foreground prose-blockquote:border-l-border
                                                        [&_.katex]:text-[15px]
                                                    "
                                                />
                                            ) : (
                                                <div className="flex items-center gap-1.5 h-6 opacity-40 py-4">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground thinking-dot [animation-delay:-0.3s]" />
                                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground thinking-dot [animation-delay:-0.15s]" />
                                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground thinking-dot" />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>}
                            </AnimatePresence>
                        </div>
                    </div>
                )}

                {/* Main content */}
                {renderedContent && (
                    <StreamingMarkdown
                        content={renderedContent}
                        isStreaming={isStreaming}
                        components={MARKDOWN_COMPONENTS}
                        className="prose prose-invert prose-base max-w-none
                            prose-p:text-foreground prose-p:leading-relaxed prose-p:text-base prose-p:my-1.5
                            prose-headings:text-foreground prose-headings:font-bold
                            prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
                            prose-li:text-base prose-li:text-foreground
                            prose-strong:text-foreground prose-a:text-brand-400
                            hover:prose-a:text-brand-300 prose-a:no-underline
                            prose-code:text-brand-300/90 prose-pre:bg-accent
                            prose-pre:border prose-pre:border-border
                            prose-blockquote:text-muted-foreground prose-blockquote:border-l-brand-500/50
                            prose-table:text-base prose-th:text-foreground prose-td:text-foreground
                            [&_.katex]:text-base [&_.katex-display]:text-lg
                            [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden
                        "
                    />
                )}

                {attachments.length > 0 && (
                    <div className={cn("space-y-2", renderedContent ? "mt-3" : "")}>
                        {attachments.map((attachment) => {
                            const isImage = attachment.mimeType.startsWith('image/');
                            return (
                                <div
                                    key={attachment.id}
                                    className="rounded-xl border border-border bg-card p-2 max-w-xl"
                                >
                                    {isImage && (
                                        <a
                                            href={attachment.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block mb-2 overflow-hidden rounded-lg border border-border bg-background"
                                        >
                                            <Image
                                                src={attachment.url}
                                                alt={attachment.name}
                                                width={768}
                                                height={512}
                                                className="h-auto w-full object-cover"
                                                unoptimized={isLegacyAttachmentProxyUrl(attachment.url)}
                                            />
                                        </a>
                                    )}
                                    <a
                                        href={attachment.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-sm text-foreground hover:text-foreground underline underline-offset-2 truncate block"
                                        title={attachment.name}
                                    >
                                        {attachment.name}
                                    </a>
                                    <p className="text-xs text-muted-foreground">{attachment.mimeType}</p>
                                </div>
                            );
                        })}
                    </div>
                )}

                {formattedStats && (
                    <div className="mt-2 text-xs text-muted-foreground">
                        {formattedStats.source === 'estimated' ? '~' : ''}
                        {formattedStats.outputTokens} tok
                        {formattedStats.reasoningTokens !== null ? ` (${formattedStats.reasoningTokens} reasoning)` : ''}
                        {' • '}
                        {formattedStats.seconds}s
                        {' • '}
                        {formattedStats.tokensPerSecond} tok/s
                        {formattedStats.ttfbSeconds !== null ? ` • TTFB ${formattedStats.ttfbSeconds}s` : ''}
                    </div>
                )}


                {/* Action icons below AI message */}
                {!isStreaming && renderedContent && (
                    <div className="flex items-center gap-1 mt-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity -ml-2">
                        {onRetry && (
                            <ActionIcon
                                icon={RefreshCcw}
                                title="Regenerate"
                                onClick={() => onRetry(id)}
                            />
                        )}
                        <ActionIcon
                            icon={GitBranch}
                            title="Branch"
                            onClick={() => onBranch?.(id)}
                        />
                        <ActionIcon
                            icon={copied ? Check : Copy}
                            title={copied ? "Copied!" : "Copy message"}
                            onClick={handleCopy}
                            className={copied ? "text-success hover:text-success" : ""}
                        />
                        {modelName && (
                            <span className="text-sm text-muted-foreground font-medium ml-3">{modelName}</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
