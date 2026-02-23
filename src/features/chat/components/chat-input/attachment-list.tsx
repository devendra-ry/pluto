'use client';

import { AlertCircle, Paperclip, RotateCcw, X } from 'lucide-react';
import { LocalAttachmentItem } from './chat-input-types';

interface AttachmentListProps {
    items: LocalAttachmentItem[];
    onRemove: (localId: string) => void;
    onRetry: (localId: string) => void;
}

const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function AttachmentList({ items, onRemove, onRetry }: AttachmentListProps) {
    if (items.length === 0) return null;

    const hasFailedAttachments = items.some((item) => item.status === 'failed');

    return (
        <div className="px-3 pb-2 flex flex-col gap-2">
            <div className="max-h-24 overflow-y-auto pr-1 space-y-2">
                {items.map((item) => (
                    <div
                        key={item.localId}
                        className="rounded-xl bg-[#2a2035]/60 border border-white/10 px-3 py-2"
                    >
                        <div className="flex items-center gap-2">
                            {item.status === 'failed' ? (
                                <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                            ) : (
                                <Paperclip className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                            )}
                            <span className="text-xs text-zinc-200 truncate flex-1">{item.file.name}</span>
                            <span className="text-[11px] text-zinc-400">{formatFileSize(item.file.size)}</span>

                            {item.status === 'failed' && (
                                <button
                                    type="button"
                                    onClick={() => onRetry(item.localId)}
                                    className="text-zinc-400 hover:text-zinc-100 transition-colors"
                                    aria-label={`Retry ${item.file.name}`}
                                >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={() => onRemove(item.localId)}
                                className="text-zinc-400 hover:text-zinc-100 transition-colors"
                                aria-label={`Remove ${item.file.name}`}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        {item.status === 'uploading' && (
                            <div className="mt-1.5">
                                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                    <div
                                        className="h-full bg-pink-400/80 transition-all duration-200"
                                        style={{ width: `${item.progress}%` }}
                                    />
                                </div>
                                <p className="mt-1 text-[10px] text-zinc-400">Uploading {item.progress}%</p>
                            </div>
                        )}

                        {item.status === 'uploaded' && (
                            <p className="mt-1 text-[10px] text-emerald-300">Uploaded</p>
                        )}

                        {item.status === 'failed' && (
                            <p className="mt-1 text-[10px] text-red-300">{item.error || 'Upload failed'}</p>
                        )}
                    </div>
                ))}
            </div>
            {hasFailedAttachments && (
                <p className="text-[11px] text-red-300/90">
                    Retry or remove failed files before sending.
                </p>
            )}
        </div>
    );
}