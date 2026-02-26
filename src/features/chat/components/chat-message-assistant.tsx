'use client';

import Image from 'next/image';
import { Copy, RefreshCcw, GitBranch, ChevronDown, Check, Brain, Loader2 } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/shared/core/utils';
import { type Attachment } from '@/shared/core/types';
import { type ChatResponseStats } from '@/features/chat/lib/chat-view';
import { isLegacyAttachmentProxyUrl } from '@/features/attachments/lib/attachment-url';
import { ActionIcon } from './chat-action-icon';
import { StreamingMarkdown } from './streaming-markdown';

const MARKDOWN_COMPONENTS: ComponentProps<typeof ReactMarkdown>['components'] = {
    pre: ({ children }) => (
        <pre className="bg-[#1a1520]/80 backdrop-blur-sm rounded-xl p-5 overflow-x-auto my-4 border border-[#2d2235]/60 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
            {children}
        </pre>
    ),
    code: ({ className, children, ...props }) => {
        const isInline = !className;
        return isInline ? (
            <code className="bg-[#2a2035]/60 px-1.5 py-0.5 rounded-md text-[15px] text-pink-300 font-mono border border-white/5" {...props}>
                {children}
            </code>
        ) : (
            <code className={cn(className, "font-mono text-[15px] leading-relaxed")} {...props}>
                {children}
            </code>
        );
    },
    li: ({ children }) => (
        <li className="text-zinc-200/90 my-1">{children}</li>
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
}: AssistantMessageProps) {
    // Collapsed by default
    const [reasoningExpanded, setReasoningExpanded] = useState(false);
    const [copied, setCopied] = useState(false);
    const { showToast } = useToast();

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        showToast('Copied to clipboard!', 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    // Don't return null if streaming (loading) - show loading indicator
    if (!content && !reasoning && attachments.length === 0 && !isThinking && !isStreaming) return null;

    // Show loading indicator for non-thinking models when streaming but no content yet
    const showLoadingDots = isStreaming && !content && !reasoning && attachments.length === 0 && !isThinking;
    const formattedStats = stats
        ? {
            outputTokens: Math.max(0, Math.round(stats.outputTokens)),
            seconds: Number(stats.seconds.toFixed(1)),
            tokensPerSecond: Number(stats.tokensPerSecond.toFixed(1)),
            ttfbSeconds: typeof stats.ttfbSeconds === 'number' ? Number(stats.ttfbSeconds.toFixed(1)) : null,
            source: stats.source ?? 'estimated',
        }
        : null;

    return (
        <div className="py-1 px-4 group">
            <div className="max-w-3xl">
                {/* Loading indicator for non-thinking models */}
                {showLoadingDots && (
                    <div className="flex items-center gap-1.5 h-6 py-4">
                        <span className="w-2 h-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-2 h-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-2 h-2 rounded-full bg-zinc-500 animate-bounce" />
                    </div>
                )}

                {/* Reasoning section (collapsible) */}
                {(reasoning || isThinking) && (
                    <div className="mb-4">
                        <div
                            className={cn(
                                "rounded-xl transition-all duration-300 ease-in-out overflow-hidden border",
                                reasoningExpanded
                                    ? "bg-[#16121a] border-white/5 shadow-xl"
                                    : "bg-transparent border-transparent"
                            )}
                        >
                            <button
                                onClick={() => setReasoningExpanded(!reasoningExpanded)}
                                className={cn(
                                    "flex items-center gap-1.5 transition-colors px-0 py-2",
                                    reasoningExpanded ? "border-b border-white/5 bg-white/[0.02] -mx-3 px-3 w-[calc(100%+1.5rem)]" : ""
                                )}
                            >
                                <Brain className={cn(
                                    "h-4 w-4 shrink-0 transition-colors",
                                    reasoningExpanded ? "text-pink-400/80" : "text-zinc-500"
                                )} />
                                <span className="text-sm font-medium tracking-tight text-zinc-400">Reasoning</span>
                                <ChevronDown className={cn(
                                    "h-3.5 w-3.5 text-zinc-600/80 shrink-0 transition-transform duration-300",
                                    reasoningExpanded && "rotate-180"
                                )} />
                                {isThinking && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-600/50 shrink-0 ml-1" />}
                            </button>

                            <div
                                className={cn(
                                    "grid transition-all duration-300 ease-in-out",
                                    reasoningExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                                )}
                            >
                                <div className="overflow-hidden">
                                    <div className="p-4 pt-1">
                                        {reasoning ? (
                                            <StreamingMarkdown
                                                content={reasoning}
                                                isStreaming={isStreaming}
                                                className="prose prose-invert prose-base max-w-none
                                                    prose-p:text-zinc-400 prose-p:leading-relaxed prose-p:text-[15px] prose-p:my-3
                                                    prose-li:text-[15px] prose-li:text-zinc-400
                                                    prose-headings:text-zinc-200 prose-headings:font-semibold
                                                    prose-strong:text-zinc-200
                                                    prose-blockquote:text-zinc-500 prose-blockquote:border-l-zinc-700
                                                    [&_.katex]:text-[15px]
                                                "
                                            />
                                        ) : (
                                            <div className="flex items-center gap-1.5 h-6 opacity-40 py-4">
                                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.3s]" />
                                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.15s]" />
                                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Main content */}
                {content && (
                    <StreamingMarkdown
                        content={content}
                        isStreaming={isStreaming}
                        components={MARKDOWN_COMPONENTS}
                        className="prose prose-invert prose-base max-w-none
                            prose-p:text-zinc-200 prose-p:leading-relaxed prose-p:text-base prose-p:my-1.5
                            prose-headings:text-zinc-100 prose-headings:font-bold
                            prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
                            prose-li:text-base prose-li:text-zinc-200
                            prose-strong:text-zinc-100 prose-a:text-pink-400
                            hover:prose-a:text-pink-300 prose-a:no-underline
                            prose-code:text-pink-300/90 prose-pre:bg-[#2a2035]/60
                            prose-pre:border prose-pre:border-white/5
                            prose-blockquote:text-zinc-400 prose-blockquote:border-l-pink-500/50
                            prose-table:text-base prose-th:text-zinc-100 prose-td:text-zinc-300
                            [&_.katex]:text-base [&_.katex-display]:text-lg
                            [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden
                        "
                    />
                )}

                {attachments.length > 0 && (
                    <div className={cn("space-y-2", content ? "mt-3" : "")}>
                        {attachments.map((attachment) => {
                            const isImage = attachment.mimeType.startsWith('image/');
                            const isVideo = attachment.mimeType.startsWith('video/');
                            return (
                                <div
                                    key={attachment.id}
                                    className="rounded-xl border border-white/10 bg-black/20 p-2 max-w-xl"
                                >
                                    {isImage && (
                                        <a
                                            href={attachment.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block mb-2 overflow-hidden rounded-lg border border-white/10 bg-black/30"
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
                                    {isVideo && (
                                        <div className="mb-2 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                                            <video
                                                controls
                                                preload="metadata"
                                                playsInline
                                                className="h-auto w-full"
                                            >
                                                <source src={attachment.url} type={attachment.mimeType} />
                                            </video>
                                        </div>
                                    )}
                                    <a
                                        href={attachment.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-sm text-zinc-200 hover:text-zinc-100 underline underline-offset-2 truncate block"
                                        title={attachment.name}
                                    >
                                        {attachment.name}
                                    </a>
                                    <p className="text-xs text-zinc-400">{attachment.mimeType}</p>
                                </div>
                            );
                        })}
                    </div>
                )}

                {formattedStats && (
                    <div className="mt-2 text-xs text-zinc-500/90">
                        {formattedStats.source === 'estimated' ? '~' : ''}
                        {formattedStats.outputTokens} tok
                        {' • '}
                        {formattedStats.seconds}s
                        {' • '}
                        {formattedStats.tokensPerSecond} tok/s
                        {formattedStats.ttfbSeconds !== null ? ` • TTFB ${formattedStats.ttfbSeconds}s` : ''}
                    </div>
                )}


                {/* Action icons below AI message */}
                {!isStreaming && content && (
                    <div className="flex items-center gap-1 mt-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity -ml-2">
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
                        />
                        <ActionIcon
                            icon={copied ? Check : Copy}
                            title={copied ? "Copied!" : "Copy message"}
                            onClick={handleCopy}
                            className={copied ? "text-emerald-400 hover:text-emerald-300" : ""}
                        />
                        {modelName && (
                            <span className="text-sm text-zinc-500/80 font-medium ml-3">{modelName}</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
