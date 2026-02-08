'use client';

import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { Copy, RotateCcw, Pencil, ArrowUpRight, ChevronDown, ChevronUp, Brain } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface ChatMessageProps {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    isStreaming?: boolean;
    modelName?: string;
    reasoning?: string;
    onEdit?: (id: string, newContent: string) => void;
    onRetry?: (id: string) => void;
    onDelete?: (id: string) => void;
}

export function ChatMessage({
    id,
    role,
    content,
    isStreaming,
    modelName,
    reasoning,
    onEdit,
    onRetry,
    onDelete,
}: ChatMessageProps) {
    const [copied, setCopied] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(content);
    // Collapsed by default
    const [reasoningExpanded, setReasoningExpanded] = useState(false);
    const isUser = role === 'user';

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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
            <div className="flex flex-col items-end py-4 px-4 group">
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
                        <div className="max-w-[75%] rounded-2xl px-4 py-3 bg-[#2a2035] text-zinc-100">
                            <p className="whitespace-pre-wrap break-words">{content}</p>
                        </div>
                        {/* Action icons below message - same row */}
                        <div className="flex items-center gap-3 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {onRetry && (
                                <button
                                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                    onClick={() => onRetry(id)}
                                    title="Retry"
                                >
                                    <RotateCcw className="h-4 w-4" />
                                </button>
                            )}
                            <button
                                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                title="Branch"
                            >
                                <ArrowUpRight className="h-4 w-4" />
                            </button>
                            {onEdit && (
                                <button
                                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                    onClick={handleEdit}
                                    title="Edit"
                                >
                                    <Pencil className="h-4 w-4" />
                                </button>
                            )}
                            <button
                                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                onClick={handleCopy}
                                title="Copy"
                            >
                                <Copy className="h-4 w-4" />
                            </button>
                        </div>
                    </>
                )}
            </div>
        );
    }

    // Assistant message - left aligned, plain text, no bubble
    return (
        <div className="py-4 px-4 group">
            <div className="max-w-3xl">
                {/* Reasoning section (collapsible) - collapsed by default */}
                {reasoning && (
                    <div className="mb-4">
                        {/* Header - just text and chevron */}
                        <button
                            onClick={() => setReasoningExpanded(!reasoningExpanded)}
                            className="flex items-center gap-2 text-zinc-400 hover:text-zinc-300 transition-colors mb-3"
                        >
                            <Brain className="h-4 w-4" />
                            <span className="text-sm font-medium">Reasoning</span>
                            {reasoningExpanded ? (
                                <ChevronUp className="h-4 w-4" />
                            ) : (
                                <ChevronDown className="h-4 w-4" />
                            )}
                        </button>

                        {/* Content - purple background, no scrollbars, no border */}
                        {reasoningExpanded && (
                            <div className="rounded-xl bg-[#1f0f1f] p-5 text-sm text-zinc-300 leading-relaxed">
                                <p className="whitespace-pre-wrap">{reasoning}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Main content */}
                <div className="prose prose-invert prose-sm max-w-none prose-p:text-zinc-200 prose-p:leading-relaxed prose-headings:text-zinc-100 prose-strong:text-zinc-100 prose-code:text-pink-300 prose-p:my-2">
                    <ReactMarkdown
                        rehypePlugins={[rehypeHighlight]}
                        remarkPlugins={[remarkGfm]}
                        components={{
                            p: ({ children }) => (
                                <p className="text-zinc-200 leading-relaxed my-1">{children}</p>
                            ),
                            pre: ({ children }) => (
                                <pre className="bg-[#1a1520] rounded-lg p-4 overflow-x-auto my-3 border border-[#2a2035]">
                                    {children}
                                </pre>
                            ),
                            code: ({ className, children, ...props }) => {
                                const isInline = !className;
                                return isInline ? (
                                    <code className="bg-[#2a2035] px-1.5 py-0.5 rounded text-sm text-pink-300" {...props}>
                                        {children}
                                    </code>
                                ) : (
                                    <code className={className} {...props}>
                                        {children}
                                    </code>
                                );
                            },
                        }}
                    >
                        {content}
                    </ReactMarkdown>
                </div>

                {isStreaming && content && (
                    <span className="inline-block w-2 h-4 bg-pink-400 animate-pulse ml-1" />
                )}

                {/* Action icons below AI message */}
                {!isStreaming && content && (
                    <div className="flex items-center gap-3 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            className="text-zinc-500 hover:text-zinc-300 transition-colors"
                            onClick={handleCopy}
                            title="Copy"
                        >
                            <Copy className="h-4 w-4" />
                        </button>
                        <button
                            className="text-zinc-500 hover:text-zinc-300 transition-colors"
                            title="Branch"
                        >
                            <ArrowUpRight className="h-4 w-4" />
                        </button>
                        {onRetry && (
                            <button
                                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                title="Regenerate"
                            >
                                <RotateCcw className="h-4 w-4" />
                            </button>
                        )}
                        {modelName && (
                            <span className="text-xs text-zinc-500 ml-1">{modelName}</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
