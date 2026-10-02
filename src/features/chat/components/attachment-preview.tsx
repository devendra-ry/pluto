'use client';

import Image from 'next/image';
import { useState } from 'react';
import { AlertCircle, FileText, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Attachment } from '@/shared/core/types';
import { isLegacyAttachmentProxyUrl } from '@/features/attachments';

interface AttachmentPreviewProps {
    attachment: Attachment;
}

export function AttachmentPreview({ attachment }: AttachmentPreviewProps) {
    const isImage = attachment.mimeType.startsWith('image/');
    const [previewState, setPreviewState] = useState<'loading' | 'ready' | 'error'>('loading');
    const [previewAttempt, setPreviewAttempt] = useState(0);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [dialogState, setDialogState] = useState<'loading' | 'ready' | 'error'>('loading');
    const [dialogAttempt, setDialogAttempt] = useState(0);

    const retryPreview = () => {
        setPreviewState('loading');
        setPreviewAttempt(attempt => attempt + 1);
    };
    const retryDialog = () => {
        setDialogState('loading');
        setDialogAttempt(attempt => attempt + 1);
    };

    return (
        <div className="rounded-xl border border-border bg-card p-2">
            {isImage ? (
                <>
                    <div className="relative mb-2 min-h-24 overflow-hidden rounded-lg border border-border bg-background">
                        {previewState !== 'error' && (
                            <button
                                type="button"
                                className="block w-full cursor-zoom-in text-left"
                                aria-label={`Preview ${attachment.name}`}
                                onClick={() => {
                                    setDialogState('loading');
                                    setIsDialogOpen(true);
                                }}
                            >
                                <Image
                                    key={previewAttempt}
                                    src={attachment.url}
                                    alt={attachment.name}
                                    width={768}
                                    height={512}
                                    className="h-auto max-h-64 w-full object-contain"
                                    unoptimized={isLegacyAttachmentProxyUrl(attachment.url)}
                                    onLoad={() => setPreviewState('ready')}
                                    onError={() => setPreviewState('error')}
                                />
                            </button>
                        )}
                        {previewState === 'loading' && (
                            <div role="status" className="absolute inset-0 flex items-center justify-center bg-background/80 text-xs text-muted-foreground">
                                Loading image preview…
                            </div>
                        )}
                        {previewState === 'error' && (
                            <div role="alert" className="flex min-h-24 items-center justify-center gap-2 p-3 text-xs text-destructive">
                                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                                <span>Image preview failed to load.</span>
                                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={retryPreview}>
                                    <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Retry
                                </Button>
                            </div>
                        )}
                    </div>
                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        <DialogContent className="max-w-5xl p-3 sm:p-5">
                            <DialogTitle className="pr-8 text-base">{attachment.name}</DialogTitle>
                            <DialogDescription>{attachment.mimeType} image preview</DialogDescription>
                            <div className="relative flex min-h-40 max-h-[75dvh] items-center justify-center overflow-auto rounded-lg bg-background">
                                {dialogState !== 'error' && (
                                    <Image
                                        key={dialogAttempt}
                                        src={attachment.url}
                                        alt={attachment.name}
                                        width={1600}
                                        height={1200}
                                        className="h-auto max-h-[70dvh] w-auto max-w-full object-contain"
                                        unoptimized={isLegacyAttachmentProxyUrl(attachment.url)}
                                        onLoad={() => setDialogState('ready')}
                                        onError={() => setDialogState('error')}
                                    />
                                )}
                                {dialogState === 'loading' && <p role="status" className="absolute text-sm text-muted-foreground">Loading full image…</p>}
                                {dialogState === 'error' && (
                                    <div role="alert" className="flex flex-col items-center gap-3 p-6 text-center text-sm text-destructive">
                                        <span>Image could not be loaded.</span>
                                        <Button type="button" variant="outline" onClick={retryDialog}>
                                            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Retry preview
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </DialogContent>
                    </Dialog>
                </>
            ) : (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-3">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground" title={attachment.name}>{attachment.name}</p>
                        <p className="text-[10px] text-muted-foreground">{attachment.mimeType}</p>
                    </div>
                    <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md px-2 py-1 text-xs text-primary underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Open ${attachment.name}`}
                    >
                        Open file
                    </a>
                </div>
            )}
            {isImage && (
                <div className="flex min-w-0 items-center justify-between gap-3">
                    <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-sm text-foreground underline underline-offset-2 hover:text-primary"
                        title={attachment.name}
                    >
                        {attachment.name}
                    </a>
                    <span className="shrink-0 text-xs text-muted-foreground">{attachment.mimeType}</span>
                </div>
            )}
        </div>
    );
}
