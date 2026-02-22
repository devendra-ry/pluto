'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Copy, RefreshCcw, SquarePen, GitBranch, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { type Attachment } from '@/lib/types';
import { ActionIcon } from './chat-action-icon';

interface UserMessageProps {
    id: string;
    content: string;
    attachments?: Attachment[];
    onEdit?: (id: string, newContent: string) => void;
    onRetry?: (id: string) => void;
}

export function UserMessage({
    id,
    content,
    attachments = [],
    onEdit,
    onRetry,
}: UserMessageProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(content);
    const [copied, setCopied] = useState(false);
    const { showToast } = useToast();

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        showToast('Copied to clipboard!', 'success');
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

    return (
        <div className="flex flex-col items-end py-1 px-4 group">
            {isEditing ? (
                <div className="w-full max-w-[90%] md:max-w-[75%] flex flex-col gap-2">
                    <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full min-h-[80px] p-3 bg-[#2a2035] text-zinc-100 rounded-2xl border border-[#3a2a4a] focus:border-pink-500/50 focus:outline-none resize-none text-base"
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
                    <div className="max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-2 bg-[#2a2035]/80 backdrop-blur-sm border border-white/5 text-zinc-100 shadow-lg">
                        {content && (
                            <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{content}</p>
                        )}

                        {attachments.length > 0 && (
                            <div className={cn("space-y-2", content ? "mt-3" : "")}>
                                {attachments.map((attachment) => {
                                    const isImage = attachment.mimeType.startsWith('image/');
                                    const isVideo = attachment.mimeType.startsWith('video/');
                                    return (
                                        <a
                                            key={attachment.id}
                                            href={attachment.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block rounded-xl border border-white/10 bg-black/20 hover:bg-black/30 transition-colors p-2"
                                        >
                                            {isImage && (
                                                <div className="mb-2 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                                                    <Image
                                                        src={attachment.url}
                                                        alt={attachment.name}
                                                        width={480}
                                                        height={320}
                                                        className="h-auto w-full object-cover"
                                                        unoptimized
                                                    />
                                                </div>
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
                                            <p className="text-sm text-zinc-200 truncate">{attachment.name}</p>
                                            <p className="text-xs text-zinc-400">{attachment.mimeType}</p>
                                        </a>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Action icons below message - same row */}
                    <div className="flex items-center gap-1 mt-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity translate-x-1">
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
                            icon={copied ? Check : Copy}
                            title={copied ? "Copied!" : "Copy message"}
                            onClick={handleCopy}
                            className={copied ? "text-emerald-400 hover:text-emerald-300" : ""}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
