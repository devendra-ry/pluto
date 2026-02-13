'use client';

import { useRef, useEffect, forwardRef, useState, useImperativeHandle, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ArrowUp, Square, Paperclip, Check, Globe, Brain, X, RotateCcw, AlertCircle } from 'lucide-react';
import { AVAILABLE_MODELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { type Attachment, type ReasoningEffort } from '@/lib/types';
import { ModelSelector } from '@/components/model-selector';
import { MAX_ATTACHMENTS_PER_MESSAGE, isImageAttachment, isPdfAttachment, isSupportedAttachmentMimeType, isTextAttachment } from '@/lib/attachments';
import { startUploadFileForThread } from '@/lib/uploads';

export interface ChatInputHandle {
    setValue: (value: string) => void;
    focus: () => void;
}

type LocalAttachmentStatus = 'uploading' | 'uploaded' | 'failed';

interface LocalAttachmentItem {
    localId: string;
    file: File;
    status: LocalAttachmentStatus;
    progress: number;
    attachment?: Attachment;
    error?: string;
}

interface ChatInputProps {
    initialValue?: string;
    onInputChange?: (value: string) => void;
    onSubmit: (value: string, attachments: Attachment[]) => Promise<boolean | void> | boolean | void;
    onEnsureThread?: () => Promise<string>;
    threadId?: string | null;
    onStop?: () => void;
    isLoading: boolean;
    currentModel: string;
    onModelChange: (model: string) => void;
    reasoningEffort: ReasoningEffort;
    onReasoningEffortChange: (effort: ReasoningEffort) => void;
}

const REASONING_OPTIONS: { value: ReasoningEffort; label: string; pro?: boolean }[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
];

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(({
    initialValue = '',
    onInputChange,
    onSubmit,
    onEnsureThread,
    threadId,
    onStop,
    isLoading,
    currentModel,
    onModelChange,
    reasoningEffort,
    onReasoningEffortChange,
}, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadTasksRef = useRef<Map<string, () => void>>(new Map());
    const [value, setValue] = useState(initialValue);
    const [attachmentItems, setAttachmentItems] = useState<LocalAttachmentItem[]>([]);
    const selectedModel = AVAILABLE_MODELS.find((m) => m.id === currentModel) ?? AVAILABLE_MODELS[0];
    const selectedReasoning = REASONING_OPTIONS.find(r => r.value === reasoningEffort) ?? REASONING_OPTIONS[0];
    const isOpenRouterModel = selectedModel.provider === 'openrouter';
    const supportsImages = !isOpenRouterModel && selectedModel.capabilities.includes('vision');
    const supportsPdfs = !isOpenRouterModel && (selectedModel.capabilities.includes('pdf') || selectedModel.provider === 'google');
    const supportsTexts = !isOpenRouterModel && selectedModel.provider === 'google';
    const supportsAttachments = supportsImages || supportsPdfs || supportsTexts;
    const activeAttachmentItems = useMemo(
        () => (supportsAttachments ? attachmentItems : []),
        [supportsAttachments, attachmentItems]
    );
    const acceptedMimeTypes = [
        supportsImages ? 'image/png,image/jpeg,image/webp,image/gif' : '',
        supportsPdfs ? 'application/pdf' : '',
        supportsTexts ? 'text/plain' : '',
    ].filter(Boolean).join(',');

    const uploadedAttachments = useMemo(
        () => activeAttachmentItems.filter((item) => item.status === 'uploaded' && item.attachment).map((item) => item.attachment as Attachment),
        [activeAttachmentItems]
    );
    const hasUploadingAttachments = activeAttachmentItems.some((item) => item.status === 'uploading');
    const hasFailedAttachments = activeAttachmentItems.some((item) => item.status === 'failed');

    useImperativeHandle(ref, () => ({
        setValue: (newValue: string) => {
            setValue(newValue);
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.style.height = 'auto';
                    textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
                }
            });
        },
        focus: () => textareaRef.current?.focus(),
    }));

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
        }
    }, [value]);

    useEffect(() => {
        const tasks = uploadTasksRef.current;
        return () => {
            for (const cancel of tasks.values()) {
                cancel();
            }
            tasks.clear();
        };
    }, []);

    const updateItem = useCallback((localId: string, updater: (item: LocalAttachmentItem) => LocalAttachmentItem) => {
        setAttachmentItems((prev) => prev.map((item) => (item.localId === localId ? updater(item) : item)));
    }, []);

    const uploadLocalFile = useCallback(async (localId: string, file: File) => {
        updateItem(localId, (item) => ({
            ...item,
            status: 'uploading',
            progress: 0,
            error: undefined,
            attachment: undefined,
        }));

        let targetThreadId = threadId ?? null;
        if (!targetThreadId && onEnsureThread) {
            try {
                targetThreadId = await onEnsureThread();
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to prepare upload thread';
                updateItem(localId, (item) => ({
                    ...item,
                    status: 'failed',
                    progress: 0,
                    error: message,
                }));
                return;
            }
        }

        if (!targetThreadId) {
            updateItem(localId, (item) => ({
                ...item,
                status: 'failed',
                progress: 0,
                error: 'Thread is not ready for uploads',
            }));
            return;
        }

        try {
            const uploadTask = startUploadFileForThread(targetThreadId, file, (progress) => {
                updateItem(localId, (item) => ({ ...item, progress }));
            });
            uploadTasksRef.current.set(localId, uploadTask.cancel);

            const attachment = await uploadTask.promise;

            updateItem(localId, (item) => ({
                ...item,
                status: 'uploaded',
                progress: 100,
                attachment,
                error: undefined,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Upload failed';
            updateItem(localId, (item) => ({
                ...item,
                status: 'failed',
                progress: 0,
                error: message,
            }));
        } finally {
            uploadTasksRef.current.delete(localId);
        }
    }, [onEnsureThread, threadId, updateItem]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isLoading && !hasUploadingAttachments && !hasFailedAttachments && (value.trim() || uploadedAttachments.length > 0)) {
                void handleSubmit();
            }
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        setValue(newValue);
        onInputChange?.(newValue);
    };

    const handleSubmit = async () => {
        if ((!value.trim() && uploadedAttachments.length === 0) || hasUploadingAttachments || hasFailedAttachments || isLoading) {
            return;
        }

        try {
            const submitted = await onSubmit(value, uploadedAttachments);
            if (submitted === false) {
                return;
            }

            setValue('');
            setAttachmentItems([]);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        } catch {
            // Parent handles toast/error feedback.
        }
    };

    const handleAttachClick = () => {
        if (isLoading || !supportsAttachments) return;
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length === 0) return;

        const availableSlots = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - activeAttachmentItems.length);
        const selectedFiles = files.slice(0, availableSlots);
        if (selectedFiles.length === 0) {
            e.target.value = '';
            return;
        }

        const nextItems: LocalAttachmentItem[] = selectedFiles.map((file) => {
            const localId = crypto.randomUUID();
            const mimeType = file.type || '';
            const isKnownType = isSupportedAttachmentMimeType(mimeType);
            const isAllowedType =
                (isImageAttachment(mimeType) && supportsImages) ||
                (isPdfAttachment(mimeType) && supportsPdfs) ||
                (isTextAttachment(mimeType) && supportsTexts);

            if (!isKnownType || !isAllowedType) {
                return {
                    localId,
                    file,
                    status: 'failed',
                    progress: 0,
                    error: 'Unsupported file type for this model',
                };
            }
            return {
                localId,
                file,
                status: 'uploading',
                progress: 0,
            };
        });

        setAttachmentItems((prev) => [...prev, ...nextItems]);
        for (const item of nextItems) {
            if (item.status === 'uploading') {
                void uploadLocalFile(item.localId, item.file);
            }
        }

        e.target.value = '';
    };

    const handleRemoveAttachment = (localId: string) => {
        const cancel = uploadTasksRef.current.get(localId);
        if (cancel) {
            cancel();
            uploadTasksRef.current.delete(localId);
        }
        setAttachmentItems((prev) => prev.filter((item) => item.localId !== localId));
    };

    const handleRetryAttachment = (localId: string) => {
        const item = attachmentItems.find((entry) => entry.localId === localId);
        if (!item) return;
        void uploadLocalFile(localId, item.file);
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <div className="pb-4 px-4 pt-0 bg-[#1a1520]">
            <div className="max-w-3xl mx-auto">
                <div className="relative rounded-2xl bg-[#221c26] border border-[#302736]/60 shadow-xl transition-all duration-200">
                    <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        multiple
                        accept={acceptedMimeTypes}
                        onChange={handleFileChange}
                    />

                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Type your message here..."
                        className={cn(
                            "w-full px-5 pt-4 bg-transparent text-zinc-100 placeholder:text-zinc-500/80 focus:outline-none resize-none min-h-[60px] text-base leading-relaxed",
                            activeAttachmentItems.length > 0 ? "pb-40" : "pb-14"
                        )}
                    />

                    {activeAttachmentItems.length > 0 && (
                        <div className="absolute left-3 right-3 bottom-12 flex flex-col gap-2 pointer-events-auto">
                            <div className="max-h-24 overflow-y-auto pr-1 space-y-2">
                                {activeAttachmentItems.map((item) => (
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
                                                    onClick={() => handleRetryAttachment(item.localId)}
                                                    className="text-zinc-400 hover:text-zinc-100 transition-colors"
                                                    aria-label={`Retry ${item.file.name}`}
                                                >
                                                    <RotateCcw className="h-3.5 w-3.5" />
                                                </button>
                                            )}

                                            <button
                                                type="button"
                                                onClick={() => handleRemoveAttachment(item.localId)}
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
                    )}

                    <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 md:px-4 pb-3">
                        <div className="flex items-center gap-1.5 md:gap-3">
                            <ModelSelector
                                currentModel={currentModel}
                                onModelChange={onModelChange}
                            />

                            {selectedModel.supportsReasoning && (
                                <div className="group/reasoning relative flex flex-col items-center">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                className="h-8 px-2 md:px-3 gap-1.5 md:gap-2 text-[#fce7ef] hover:text-white bg-[#2a2035]/30 hover:bg-[#2a2035]/50 border border-white/10 rounded-xl md:rounded-full transition-all text-sm font-semibold"
                                            >
                                                <Brain className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                                <span className="capitalize hidden md:inline">{selectedReasoning.label}</span>
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            align="start"
                                            side="top"
                                            className="w-44 bg-[#1a1520] border-[#3a3045] shadow-2xl mb-2"
                                        >
                                            {REASONING_OPTIONS.map((option) => (
                                                <DropdownMenuItem
                                                    key={option.value}
                                                    onClick={() => onReasoningEffortChange(option.value)}
                                                    className={cn(
                                                        'flex items-center gap-3 py-2 px-3 cursor-pointer focus:bg-[#2a2535]',
                                                        option.value === reasoningEffort && 'bg-[#2a2535]'
                                                    )}
                                                >
                                                    <Brain className="h-4 w-4 text-zinc-400 shrink-0" />
                                                    <span className="text-zinc-100 flex-1">{option.label}</span>
                                                    {option.value === reasoningEffort && (
                                                        <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                                                    )}
                                                </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuContent>
                                    </DropdownMenu>

                                    <div className="absolute bottom-full mb-2 hidden group-hover/reasoning:block z-50 pointer-events-none">
                                        <div className="bg-[#1a1520]/95 backdrop-blur-md text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/10 font-semibold tracking-tight animate-in fade-in zoom-in-95 duration-200">
                                            <span className="text-[#fce7ef]">Reasoning Effort</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <Button
                                variant="ghost"
                                className="h-8 px-2 md:px-3 gap-1.5 md:gap-2 text-[#fce7ef] hover:text-white bg-[#2a2035]/30 hover:bg-[#2a2035]/50 border border-white/10 rounded-xl md:rounded-full transition-all text-sm font-semibold"
                            >
                                <Globe className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                <span className="hidden md:inline">Search</span>
                            </Button>

                            <div className="group/attach relative flex flex-col items-center">
                                <Button
                                    variant="ghost"
                                    type="button"
                                    onClick={handleAttachClick}
                                    disabled={isLoading || !supportsAttachments || activeAttachmentItems.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                                    className="h-8 w-8 md:w-11 p-0 text-[#fce7ef] hover:text-white bg-[#2a2035]/30 hover:bg-[#2a2035]/50 border border-white/10 rounded-xl md:rounded-full transition-all flex items-center justify-center"
                                >
                                    <Paperclip className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                </Button>

                                <div className="absolute bottom-full mb-2 hidden group-hover/attach:block z-50 pointer-events-none">
                                    <div className="bg-[#1a1520]/95 backdrop-blur-md text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/10 font-semibold tracking-tight animate-in fade-in zoom-in-95 duration-200">
                                        <span className="text-[#fce7ef]">
                                            {supportsAttachments
                                                ? 'Attach file'
                                                : 'Use an attachment-capable model to attach files'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {isLoading && onStop ? (
                            <Button
                                type="button"
                                size="icon"
                                onClick={onStop}
                                className="h-8 w-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all border border-red-500/20"
                            >
                                <Square className="h-3.5 w-3.5 fill-current" />
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                size="icon"
                                onClick={() => void handleSubmit()}
                                disabled={
                                    isLoading ||
                                    hasUploadingAttachments ||
                                    hasFailedAttachments ||
                                    (!value.trim() && uploadedAttachments.length === 0)
                                }
                                className="h-8 w-8 rounded-lg bg-[#3a283e] hover:bg-[#4a354e] text-pink-300/80 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <ArrowUp className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});
ChatInput.displayName = 'ChatInput';
