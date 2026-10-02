'use client';

import { AlertCircle, Paperclip, RotateCcw, X } from 'lucide-react';
import type { Attachment } from '@/shared/core/types';

interface LocalAttachmentBase {
    localId: string;
    file: File;
}

export type LocalAttachmentItem =
    | (LocalAttachmentBase & { status: 'uploading'; progress: number })
    | (LocalAttachmentBase & { status: 'uploaded'; progress: 100; attachment: Attachment })
    | (LocalAttachmentBase & { status: 'failed'; progress: 0; error: string });
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
                        className="rounded-xl bg-accent border border-border px-3 py-2"
                    >
                        <div className="flex items-center gap-2">
                            {item.status === 'failed' ? (
                                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                            ) : (
                                <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                            <span className="text-xs text-foreground truncate flex-1">{item.file.name}</span>
                            <span className="text-[11px] text-muted-foreground">{formatFileSize(item.file.size)}</span>

                            {item.status === 'failed' && (
                                <button
                                    type="button"
                                    onClick={() => onRetry(item.localId)}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
                                    aria-label={`Retry ${item.file.name}`}
                                >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={() => onRemove(item.localId)}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
                                aria-label={`Remove ${item.file.name}`}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        {item.status === 'uploading' && (
                            <div className="mt-1.5">
                                <div role="progressbar" aria-label={`Uploading ${item.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress} className="h-1.5 rounded-full bg-input overflow-hidden">
                                    <div
                                        className="h-full bg-brand-400/80 transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-200"
                                        style={{ width: `${item.progress}%` }}
                                    />
                                </div>
                                <p className="mt-1 text-[10px] text-muted-foreground">Uploading {item.progress}%</p>
                            </div>
                        )}

                        {item.status === 'uploaded' && (
                            <p className="mt-1 text-[10px] text-success">Uploaded</p>
                        )}

                        {item.status === 'failed' && (
                            <p className="mt-1 text-[10px] text-destructive">{item.error || 'Upload failed'}</p>
                        )}
                    </div>
                ))}
            </div>
            {hasFailedAttachments && (
                <p className="text-[11px] text-destructive">
                    Retry or remove failed files before sending.
                </p>
            )}
        </div>
    );
}
