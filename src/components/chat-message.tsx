'use client';

import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { Copy, RefreshCcw, SquarePen, GitBranch, ChevronDown, Brain, Loader2, type LucideIcon } from 'lucide-react';
import { useState, memo } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface ActionIconProps {
    icon: LucideIcon;
    title: string;
    onClick?: () => void;
    className?: string;
}

function ActionIcon({ icon: Icon, title, onClick, className }: ActionIconProps) {
    return (
        <div className="relative group/icon flex flex-col items-center">
            <button
                onClick={onClick}
                className={cn(
                    "p-2 rounded-lg text-zinc-400/70 hover:text-zinc-100 hover:bg-zinc-800/50 transition-all",
                    className
                )}
            >
                <Icon className="h-[1.1rem] w-[1.1rem]" />
            </button>
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover/icon:block z-[100] pointer-events-none">
                <div className="bg-zinc-950 text-white text-[11px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/5 font-medium tracking-tight animate-in fade-in zoom-in-95 duration-200">
                    {title}
                </div>
            </div>
        </div>
    );
}

interface ChatMessageProps {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    isStreaming?: boolean;
    isThinking?: boolean;
    modelName?: string;
    reasoning?: string;
    onEdit?: (id: string, newContent: string) => void;
    onRetry?: (id: string) => void;
    onDelete?: (id: string) => void;
}

export const ChatMessage = memo(function ChatMessage({
    id,
    role,
    content,
    isStreaming,
    isThinking,
    modelName,
    reasoning,
    onEdit,
    onRetry,
}: ChatMessageProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(content);
    // Collapsed by default
    const [reasoningExpanded, setReasoningExpanded] = useState(false);
    const isUser = role === 'user';
    const { showToast } = useToast();

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        showToast('Copied to clipboard!', 'success');
    };

    const handleEdit = () => {
        setEditContent(content);
        setIsEditing(true);
    };

    const handleSaveEdit = () => {
        if (onEdit && editContent.trim()) {
            onEdit(id, editContent.trim());
        }
        setIsEditing(false);
    };

    const handleCancelEdit = () => {
        setEditContent(content);
        setIsEditing(false);
    };

    // User message - right aligned with bubble
    if (isUser) {
        return (
            <div className="flex flex-col items-end py-3 px-4 group">
                {isEditing ? (
                    <div className="w-full max-w-[75%] flex flex-col gap-2">
                        <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="w-full min-h-[80px] p-3 bg-[#2a2035] text-zinc-100 rounded-2xl border border-[#3a2a4a] focus:border-pink-500/50 focus:outline-none resize-none"
                            autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={handleCancelEdit}
                                className="text-zinc-400 hover:text-zinc-200"
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleSaveEdit}
                                className="bg-pink-600 hover:bg-pink-500 text-white"
                            >
                                Save & Resend
                            </Button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="max-w-[75%] rounded-2xl px-4 py-3 bg-[#2a2035]/80 backdrop-blur-sm border border-white/5 text-zinc-100 shadow-lg">
                            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{content}</p>
                        </div>
                        {/* Action icons below message - same row */}
                        <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity translate-x-1">
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
                            {onEdit && (
                                <ActionIcon
                                    icon={SquarePen}
                                    title="Edit message"
                                    onClick={handleEdit}
                                />
                            )}
                            <ActionIcon
                                icon={Copy}
                                title="Copy message"
                                onClick={handleCopy}
                            />
                        </div>
                    </>
                )}
            </div>
        );
    }

    // Assistant message - left aligned, plain text, no bubble
    // Don't return null if streaming (loading) - show loading indicator
    if (!isUser && !content && !reasoning && !isThinking && !isStreaming) return null;

    // Show loading indicator for non-thinking models when streaming but no content yet
    const showLoadingDots = isStreaming && !content && !reasoning && !isThinking;

    return (
        <div className="py-3 px-4 group">
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
                    <div className="mb-6">
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
                                <span className="text-[13px] font-medium tracking-tight text-zinc-400">Reasoning</span>
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
                                            <div className="prose prose-invert prose-sm max-w-none prose-p:text-zinc-400 prose-p:leading-relaxed prose-headings:text-zinc-200 prose-headings:font-semibold prose-strong:text-zinc-200 prose-p:my-3">
                                                <ReactMarkdown
                                                    rehypePlugins={[rehypeHighlight, rehypeRaw]}
                                                    remarkPlugins={[remarkGfm]}
                                                >
                                                    {reasoning}
                                                </ReactMarkdown>
                                            </div>
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
                    <div className="prose prose-invert prose-sm max-w-none 
                        prose-p:text-zinc-200 prose-p:leading-relaxed prose-p:text-[15px] prose-p:my-3
                        prose-headings:text-zinc-100 prose-headings:font-semibold prose-headings:mt-5 prose-headings:mb-2
                        prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
                        prose-strong:text-zinc-100 
                        prose-code:text-pink-300
                        prose-ol:my-3 prose-ul:my-3 prose-li:my-1
                        prose-hr:my-4 prose-hr:border-zinc-700/50
                    ">
                        <ReactMarkdown
                            rehypePlugins={[rehypeHighlight, rehypeRaw]}
                            remarkPlugins={[remarkGfm]}
                            components={{
                                pre: ({ children }) => (
                                    <pre className="bg-[#1a1520]/80 backdrop-blur-sm rounded-xl p-5 overflow-x-auto my-4 border border-[#2d2235]/60 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                                        {children}
                                    </pre>
                                ),
                                code: ({ className, children, ...props }) => {
                                    const isInline = !className;
                                    return isInline ? (
                                        <code className="bg-[#2a2035]/60 px-1.5 py-0.5 rounded-md text-sm text-pink-300 font-mono border border-white/5" {...props}>
                                            {children}
                                        </code>
                                    ) : (
                                        <code className={cn(className, "font-mono text-sm leading-relaxed")} {...props}>
                                            {children}
                                        </code>
                                    );
                                },
                                li: ({ children }) => (
                                    <li className="text-zinc-200/90 my-1">{children}</li>
                                ),
                            }}
                        >
                            {content}
                        </ReactMarkdown>
                    </div>
                )}


                {/* Action icons below AI message */}
                {!isStreaming && content && (
                    <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity -ml-2">
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
                            icon={Copy}
                            title="Copy message"
                            onClick={handleCopy}
                        />
                        {modelName && (
                            <span className="text-xs text-zinc-500/80 font-medium ml-3">{modelName}</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
);
