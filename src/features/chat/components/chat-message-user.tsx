'use client';

import { useState } from 'react';
import { Copy, RefreshCcw, SquarePen, GitBranch, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { useCopyToClipboard } from '@/shared/hooks/use-copy-to-clipboard';
import { cn } from '@/shared/core/utils';
import { type Attachment } from '@/shared/core/types';
import { ActionIcon } from './chat-action-icon';
import { AttachmentPreview } from './attachment-preview';

interface UserMessageProps {
    id: string;
    content: string;
    attachments?: Attachment[];
    onEdit?: (id: string, newContent: string) => void;
    onRetry?: (id: string) => void;
    onBranch?: (id: string) => void;
}

export function UserMessage({
    id,
    content,
    attachments = [],
    onEdit,
    onRetry,
    onBranch,
}: UserMessageProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(content);
    const { copied, copy } = useCopyToClipboard();

    const handleCopy = () => copy(content);

    const handleEdit = () => {
        setEditContent(content);
        setIsEditing(true);
    };

    const handleSaveEdit = () => {
        if (!onEdit || !editContent.trim() || editContent.trim() === content.trim()) return;
        onEdit(id, editContent.trim());
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
                    <Textarea
                        aria-label="Edit message"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={e => {
                            if (e.nativeEvent.isComposing) return;
                            if (e.key === 'Escape') { e.preventDefault(); handleCancelEdit(); }
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSaveEdit(); }
                        }}
                        className="min-h-[80px] rounded-2xl bg-accent p-3 text-base text-foreground focus:border-primary/50 focus-visible:ring-ring resize-none"
                        autoFocus
                    />

                    <div className="flex gap-2 justify-end">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleCancelEdit}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={!editContent.trim() || editContent.trim() === content.trim()}
                            className="bg-primary hover:bg-brand-600 text-primary-foreground"
                        >
                            Save & Resend
                        </Button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="max-w-[85%] md:max-w-[75%] rounded-2xl rounded-br-md px-4 py-3 bg-secondary border border-border text-secondary-foreground shadow-sm">
                        {content && (
                            <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{content}</p>
                        )}

                        {attachments.length > 0 && (
                            <div className={cn("space-y-2", content ? "mt-3" : "")}>
                                {attachments.map((attachment) => {
                                    return (
                                        <AttachmentPreview key={attachment.id} attachment={attachment} />
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Action icons below message - same row */}
                    <div className="flex items-center gap-1 mt-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity translate-x-1">
                        {onRetry && (
                            <ActionIcon
                                icon={RefreshCcw}
                                title="Regenerate"
                                onClick={() => onRetry(id)}
                            />
                        )}
                        {onBranch && <ActionIcon
                            icon={GitBranch}
                            title="Branch"
                            onClick={() => onBranch(id)}
                        />}
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
                            className={copied ? "text-success hover:text-success" : ""}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
