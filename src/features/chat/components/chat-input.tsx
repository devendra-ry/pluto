'use client';

import { useRef, useEffect, useLayoutEffect, forwardRef, useState, useImperativeHandle, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowUp, Square, Paperclip } from 'lucide-react';
import { AVAILABLE_MODELS } from '@/shared/core/constants';
import { type Attachment, type ReasoningEffort } from '@/shared/core/types';
import { MAX_ATTACHMENTS_PER_MESSAGE, isImageAttachment } from '@/features/attachments';
import { cleanupThreadAttachments, startUploadFileForThread } from '@/features/uploads';
import { useToast } from '@/components/ui/toast';
import { AttachmentList, type LocalAttachmentItem } from './chat-input-attachments';
import { ReasoningSelector, SystemPromptSelector } from './chat-input-settings';
import { ModelSelector } from './model-selector';
import { isFileAllowedForChatInput, selectChatInputFiles } from '../lib/chat-input-policy';
import { MAX_CHAT_MESSAGE_CHARS } from '@/shared/validation/request-limits';
import { useAuthUserId } from '@/features/shell';
import { useTextDraftRecovery } from '../hooks/use-text-draft-recovery';

export interface ChatInputHandle {
    setValue: (value: string) => void;
    focus: () => void;
}

interface ChatInputProps {
    initialValue?: string;
    draftScopeId?: string;
    onInputChange?: (value: string) => void;
    onSubmit: (
        value: string,
        attachments: Attachment[]
    ) => Promise<boolean | void> | boolean | void;
    onEnsureThread?: () => Promise<string>;
    threadId?: string | null;
    onStop?: () => void;
    isLoading: boolean;
    submitDisabled?: boolean;
    currentModel: string;
    onModelChange: (model: string) => void;
    reasoningEffort: ReasoningEffort;
    onReasoningEffortChange: (effort: ReasoningEffort) => void;
    systemPrompt?: string;
    onSystemPromptChange?: (prompt: string) => Promise<void> | void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(({
    initialValue = '',
    draftScopeId,
    onInputChange,
    onSubmit,
    onEnsureThread,
    threadId,
    onStop,
    isLoading,
    submitDisabled = false,
    currentModel,
    onModelChange,
    reasoningEffort,
    onReasoningEffortChange,
    systemPrompt = '',
    onSystemPromptChange,
}, ref) => {
    const userId = useAuthUserId();
    const effectiveDraftScopeId = draftScopeId ?? threadId ?? 'home';
    const draftRecovery = useTextDraftRecovery(userId, effectiveDraftScopeId);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const resizeAnimationRef = useRef<Animation | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadTasksRef = useRef<Map<string, () => void>>(new Map());
    const valueRef = useRef(initialValue);
    const attachmentItemsRef = useRef<LocalAttachmentItem[]>([]);
    const submissionInFlightRef = useRef(false);
    const draftRevisionRef = useRef(0);
    const mountedRef = useRef(true);
    const previousThreadIdRef = useRef(threadId);
    const [value, setValue] = useState(initialValue);
    const [showRecoveredHint, setShowRecoveredHint] = useState(false);
    const [attachmentItems, setAttachmentItems] = useState<LocalAttachmentItem[]>([]);
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const { showToast } = useToast();
    const selectedModel = AVAILABLE_MODELS.find((m) => m.id === currentModel) ?? AVAILABLE_MODELS[0];
    const supportsImages = selectedModel.capabilities.includes('vision');
    const supportsPdfs = selectedModel.capabilities.includes('pdf') || selectedModel.provider === 'google';
    const supportsTexts = selectedModel.provider === 'google';
    const supportsImageUploads = supportsImages;
    const supportsAttachments = supportsImages || supportsPdfs || supportsTexts;
    const activeAttachmentItems = attachmentItems;
    const acceptedMimeTypes = [
        supportsImages ? 'image/png,image/jpeg,image/webp,image/gif' : '',
        supportsPdfs ? 'application/pdf' : '',
        supportsTexts ? 'text/plain' : '',
    ].filter(Boolean).join(',');

    const uploadedAttachments = useMemo(
        () => activeAttachmentItems
            .filter((item): item is Extract<LocalAttachmentItem, { status: 'uploaded' }> => item.status === 'uploaded')
            .map((item) => item.attachment),
        [activeAttachmentItems]
    );
    const hasUploadingAttachments = activeAttachmentItems.some((item) => item.status === 'uploading');
    const hasFailedAttachments = activeAttachmentItems.some((item) => item.status === 'failed');
    const hasIncompatibleAttachments = activeAttachmentItems.some(item => !isFileAllowedForChatInput(
        item.file.type, { images: supportsImages, pdfs: supportsPdfs, texts: supportsTexts },
    ));
    const isMessageTooLong = value.length > MAX_CHAT_MESSAGE_CHARS;


    const resizeTextarea = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        // Start from the currently visible height so rapid typing or clearing
        // reverses an in-flight resize without jumping to its old destination.
        const previousHeight = textarea.getBoundingClientRect().height;
        resizeAnimationRef.current?.cancel();
        textarea.style.height = 'auto';
        const nextHeight = Math.min(Math.max(textarea.scrollHeight, 60), 200);
        textarea.style.height = `${nextHeight}px`;

        if (Math.abs(previousHeight - nextHeight) < 1
            || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        resizeAnimationRef.current = textarea.animate(
            [{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }],
            { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
    }, []);

    useLayoutEffect(() => {
        resizeTextarea();
        valueRef.current = value;
    }, [value, resizeTextarea]);

    useEffect(() => {
        if (!draftRecovery.isLoaded || draftRevisionRef.current !== 0 || valueRef.current !== initialValue) return;
        if (!draftRecovery.restoredText) return;
        valueRef.current = draftRecovery.restoredText;
        setValue(draftRecovery.restoredText);
        onInputChange?.(draftRecovery.restoredText);
        setShowRecoveredHint(true);
    }, [draftRecovery.isLoaded, draftRecovery.restoredText, initialValue, onInputChange]);

    useEffect(() => () => resizeAnimationRef.current?.cancel(), []);

    useEffect(() => {
        mountedRef.current = true;
        const tasks = uploadTasksRef.current;
        return () => {
            mountedRef.current = false;
            for (const cancel of tasks.values()) {
                cancel();
            }
            tasks.clear();
        };
    }, []);

    useLayoutEffect(() => {
        const previousThreadId = previousThreadIdRef.current;
        previousThreadIdRef.current = threadId;
        // null -> id is creation of the same draft; switching existing chats
        // must cancel every pending task, including thread preparation.
        if (previousThreadId && previousThreadId !== threadId) {
            for (const cancel of uploadTasksRef.current.values()) cancel();
            uploadTasksRef.current.clear();
            attachmentItemsRef.current = [];
            setAttachmentItems([]);
            draftRevisionRef.current += 1;
        }
    }, [threadId]);

    const updateItem = useCallback((localId: string, updater: (item: LocalAttachmentItem) => LocalAttachmentItem) => {
        const items = attachmentItemsRef.current.map(item => item.localId === localId ? updater(item) : item);
        attachmentItemsRef.current = items;
        setAttachmentItems(items);
    }, []);

    const uploadLocalFile = useCallback(async (localId: string, file: File) => {
        // Register cancellation before thread preparation, not just after XHR starts.
        uploadTasksRef.current.get(localId)?.();
        let canceled = false;
        let cancelTransfer = () => {};
        const cancel = () => { canceled = true; cancelTransfer(); };
        uploadTasksRef.current.set(localId, cancel);
        const updateActiveItem = (updater: (item: LocalAttachmentItem) => LocalAttachmentItem) => {
            if (!canceled && uploadTasksRef.current.get(localId) === cancel) updateItem(localId, updater);
        };
        updateActiveItem(item => ({ localId: item.localId, file: item.file, status: 'uploading', progress: 0 }));
        try {
            const targetThreadId = threadId ?? await onEnsureThread?.();
            if (canceled) return;
            if (!targetThreadId) throw new Error('Thread is not ready for uploads');
            const uploadTask = startUploadFileForThread(targetThreadId, file, progress => {
                updateActiveItem(item => item.status === 'uploading' ? { ...item, progress } : item);
            });
            cancelTransfer = uploadTask.cancel;
            const attachment = await uploadTask.promise;
            updateActiveItem(item => ({
                localId: item.localId, file: item.file, status: 'uploaded', progress: 100, attachment,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Upload failed';
            updateActiveItem(item => ({
                localId: item.localId, file: item.file, status: 'failed', progress: 0, error: message,
            }));
        } finally {
            if (uploadTasksRef.current.get(localId) === cancel) uploadTasksRef.current.delete(localId);
        }
    }, [onEnsureThread, threadId, updateItem]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Enter can be part of an active IME composition (for example, to
        // choose a Japanese or Chinese candidate). Let the browser finish it.
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isLoading && !submitDisabled && !hasUploadingAttachments && !hasFailedAttachments && !hasIncompatibleAttachments && !isMessageTooLong && (value.trim() || uploadedAttachments.length > 0)) {
                void handleSubmit();
            }
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        draftRevisionRef.current += 1;
        valueRef.current = newValue;
        setValue(newValue);
        onInputChange?.(newValue);
        draftRecovery.update(newValue);
        setShowRecoveredHint(false);
    };

    const handleSubmit = async () => {
        if (submissionInFlightRef.current || (!value.trim() && uploadedAttachments.length === 0) || hasUploadingAttachments || hasFailedAttachments || hasIncompatibleAttachments || isMessageTooLong || isLoading || submitDisabled) {
            return;
        }

        const submittedValue = value;
        const submittedItems = attachmentItems;
        const submittedAttachments = uploadedAttachments;
        const submittedRevision = draftRevisionRef.current;
        submissionInFlightRef.current = true;
        draftRecovery.beginSubmission(submittedValue);

        // Clear immediately so user can start typing the next prompt while generation runs.
        setValue('');
        valueRef.current = '';
        onInputChange?.('');
        setAttachmentItems([]);
        attachmentItemsRef.current = [];
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }

        try {
            const submitted = await onSubmit(submittedValue, submittedAttachments);
            if (submitted === false) {
                // Restore only if user has not started drafting a new message yet.
                if (mountedRef.current && draftRevisionRef.current === submittedRevision && valueRef.current.trim().length === 0 && attachmentItemsRef.current.length === 0) {
                    valueRef.current = submittedValue;
                    setValue(submittedValue);
                    onInputChange?.(submittedValue);
                    draftRecovery.update(submittedValue);
                    setShowRecoveredHint(true);
                    setAttachmentItems(submittedItems);
                    attachmentItemsRef.current = submittedItems;
                    if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                    }
                }
                return;
            }
            if (draftRevisionRef.current === submittedRevision) draftRecovery.clear();
        } catch (error) {
            if (process.env.NODE_ENV !== 'production') {
                console.warn('[chat-input] Submit failed, restoring local draft state', error);
            }
            // Parent handles toast/error feedback.
            // Restore only if user has not started drafting a new message yet.
            if (mountedRef.current && draftRevisionRef.current === submittedRevision && valueRef.current.trim().length === 0 && attachmentItemsRef.current.length === 0) {
                valueRef.current = submittedValue;
                setValue(submittedValue);
                onInputChange?.(submittedValue);
                draftRecovery.update(submittedValue);
                setShowRecoveredHint(true);
                setAttachmentItems(submittedItems);
                attachmentItemsRef.current = submittedItems;
                if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                }
            }
        } finally {
            submissionInFlightRef.current = false;
        }
    };

    useImperativeHandle(ref, () => ({
        setValue: (newValue: string) => {
            draftRevisionRef.current += 1;
            valueRef.current = newValue;
            setValue(newValue);
            draftRecovery.update(newValue);
            setShowRecoveredHint(false);
        },
        focus: () => textareaRef.current?.focus(),
    }), [draftRecovery]);

    const handleAttachClick = () => {
        if (isLoading || !supportsAttachments) return;
        fileInputRef.current?.click();
    };

    const enqueueLocalFiles = useCallback((files: File[]) => {
        if (files.length === 0) return;
        if (!supportsAttachments) {
            showToast('Attachments are not supported for the current model', 'error');
            return;
        }

        const currentBytes = attachmentItemsRef.current.reduce((total, item) => total + item.file.size, 0);
        const { accepted: selectedFiles, rejected } = selectChatInputFiles(files, {
            currentCount: attachmentItemsRef.current.length,
            currentBytes,
        });
        if (rejected.length) {
            const reasons = new Set(rejected.map(item => item.reason));
            const limits = [
                reasons.has('individual-size') ? '20 MB per file' : '',
                reasons.has('total-size') ? '50 MB total' : '',
                reasons.has('count') ? `${MAX_ATTACHMENTS_PER_MESSAGE} files per message` : '',
            ].filter(Boolean).join(', ');
            showToast(`${rejected.length} file(s) not added. Limit: ${limits}.`, 'error');
        }
        if (!selectedFiles.length) return;

        const nextItems: LocalAttachmentItem[] = selectedFiles.map((file) => {
            const localId = crypto.randomUUID();
            const mimeType = file.type || '';
            const isAllowedType = isFileAllowedForChatInput(
                mimeType,
                { images: supportsImages, pdfs: supportsPdfs, texts: supportsTexts },
            );

            if (!isAllowedType) {
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

        draftRevisionRef.current += 1;
        attachmentItemsRef.current = [...attachmentItemsRef.current, ...nextItems];
        setAttachmentItems(attachmentItemsRef.current);
        for (const item of nextItems) {
            if (item.status === 'uploading') {
                void uploadLocalFile(item.localId, item.file);
            }
        }

    }, [
        supportsAttachments,
        supportsImages,
        supportsPdfs,
        supportsTexts,
        uploadLocalFile,
        showToast,
    ]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        enqueueLocalFiles(files);
        e.target.value = '';
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const clipboardItems = Array.from(e.clipboardData?.items ?? []);
        if (clipboardItems.length === 0) return;

        const pastedImageFiles = clipboardItems
            .filter((item) => item.kind === 'file')
            .map((item) => item.getAsFile())
            .filter((file): file is File => Boolean(file))
            .filter((file) => isImageAttachment(file.type || ''));

        if (pastedImageFiles.length === 0) return;

        e.preventDefault();

        if (isLoading) {
            showToast('Please wait for current response to finish before attaching images', 'error');
            return;
        }

        if (!supportsAttachments || !supportsImageUploads) {
            showToast('Pasted images are not supported for the current model', 'error');
            return;
        }

        enqueueLocalFiles(pastedImageFiles);
    };

    const handleRemoveAttachment = (localId: string) => {
        draftRevisionRef.current += 1;
        const item = attachmentItemsRef.current.find(item => item.localId === localId);
        const cancel = uploadTasksRef.current.get(localId);
        if (cancel) {
            cancel();
            uploadTasksRef.current.delete(localId);
        }
        attachmentItemsRef.current = attachmentItemsRef.current.filter(item => item.localId !== localId);
        setAttachmentItems(attachmentItemsRef.current);
        if (item?.status === 'uploaded' && threadId && item.attachment.path) {
            void cleanupThreadAttachments(threadId, [item.attachment.path]).catch(error => {
                console.warn('[chat-input] Failed to clean up removed file:', error);
            });
        }
    };

    const handleRetryAttachment = (localId: string) => {
        const item = attachmentItems.find((entry) => entry.localId === localId);
        if (!item) return;
        void uploadLocalFile(localId, item.file);
    };

    return (
        <div className="px-3 md:px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-background">
            <div className="max-w-3xl mx-auto">
                <div
                    className={`relative rounded-2xl bg-card border shadow-[0_8px_32px_#0003] transition-[border-color,box-shadow] duration-200 ease-fluid focus-within:border-ring/70 focus-within:ring-2 focus-within:ring-ring/10 ${isDraggingFiles ? 'border-ring ring-2 ring-ring/20' : 'border-input'}`}
                    onDragOver={event => {
                        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = isLoading || !supportsAttachments ? 'none' : 'copy';
                        setIsDraggingFiles(true);
                    }}
                    onDragLeave={event => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingFiles(false);
                    }}
                    onDrop={event => {
                        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
                        event.preventDefault();
                        setIsDraggingFiles(false);
                        if (isLoading) { showToast('Wait for the response to finish before attaching files.', 'info'); return; }
                        enqueueLocalFiles(Array.from(event.dataTransfer.files));
                    }}
                >
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
                        rows={1}
                        value={value}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        placeholder={isDraggingFiles ? 'Drop files here to attach…' : 'Ask anything, or share a file…'}
                        aria-label="Message"
                        aria-describedby="composer-hint"
                        aria-invalid={isMessageTooLong || undefined}
                        className="block w-full px-4 md:px-5 pt-4 pb-3 bg-transparent text-foreground placeholder:text-muted-foreground focus-visible:outline-none resize-none min-h-[60px] text-base leading-relaxed overflow-y-auto"
                    />

                    <AttachmentList
                        items={activeAttachmentItems}
                        onRemove={handleRemoveAttachment}
                        onRetry={handleRetryAttachment}
                    />

                    <div className="flex items-center justify-between gap-2 px-2 md:px-4 pb-3 pt-1">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 md:gap-2">
                            <div className="min-w-0">
                                <ModelSelector
                                    currentModel={currentModel}
                                    onModelChange={onModelChange}
                                />
                            </div>

                            {selectedModel.supportsReasoning && (
                                <ReasoningSelector
                                    reasoningEffort={reasoningEffort}
                                    onReasoningEffortChange={onReasoningEffortChange}
                                />
                            )}


                            <SystemPromptSelector
                                systemPrompt={systemPrompt}
                                {...(onSystemPromptChange ? { onSystemPromptChange } : {})}
                            />

                            <div className="group/attach relative flex shrink-0 flex-col items-center">
                                <Button
                                    variant="ghost"
                                    type="button"
                                    aria-label={supportsAttachments ? 'Attach file' : 'Attachments require an attachment-capable model'}
                                    onClick={handleAttachClick}
                                    disabled={
                                        isLoading
                                        || !supportsAttachments
                                        || activeAttachmentItems.length >= MAX_ATTACHMENTS_PER_MESSAGE
                                    }
                                    title="Attach images, PDFs, or text · 20 MB per file"
                                    className="h-10 w-10 p-0 text-muted-foreground hover:text-foreground hover:bg-accent rounded-xl transition-colors flex items-center justify-center"
                                >
                                    <Paperclip className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                </Button>

                                <div className="absolute bottom-full mb-2 hidden group-hover/attach:block group-focus-within/attach:block z-50 pointer-events-none">
                                    <div className="bg-popover backdrop-blur-md text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-border font-semibold tracking-tight motion-surface">
                                        <span className="text-brand-100">
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
                                aria-label="Stop generating"
                                onClick={onStop}
                                className="shrink-0 h-10 w-10 rounded-xl bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors border border-destructive/30"
                            >
                                <Square className="h-3.5 w-3.5 fill-current" />
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                size="icon"
                                aria-label="Send message"
                                onClick={() => void handleSubmit()}
                                disabled={
                                    isLoading || submitDisabled ||
                                    hasUploadingAttachments ||
                                    hasFailedAttachments ||
                                    hasIncompatibleAttachments ||
                                    isMessageTooLong ||
                                    (!value.trim() && uploadedAttachments.length === 0)
                                }
                                className="shrink-0 h-10 w-10 rounded-xl bg-primary hover:bg-brand-600 text-primary-foreground transition-colors disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-100 disabled:cursor-not-allowed"
                            >
                                <ArrowUp className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
                <p id="composer-hint" role={isMessageTooLong || hasIncompatibleAttachments ? 'alert' : undefined} className={`mt-2 px-1 text-xs ${isMessageTooLong || hasIncompatibleAttachments ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {isMessageTooLong ? `Message exceeds ${MAX_CHAT_MESSAGE_CHARS.toLocaleString()} characters. Shorten it to send.`
                        : hasIncompatibleAttachments ? 'This model cannot read one or more files. Change models or remove those files.'
                        : hasUploadingAttachments ? 'Uploading files… You can send when all files are ready.'
                        : hasFailedAttachments ? 'Retry or remove failed files to send your message.'
                        : isLoading ? 'You can draft your next message while the response finishes.'
                        : <><span className="hidden sm:inline">Enter to send · Shift + Enter for a new line<span aria-hidden="true"> · </span></span>AI can make mistakes. Check important details.</>}
                </p>
                {showRecoveredHint && (
                    <div className="mt-1 flex items-center gap-2 px-1 text-xs text-muted-foreground" role="status" aria-live="polite">
                        <span>Draft restored</span>
                        <button
                            type="button"
                            className="underline underline-offset-2 hover:text-foreground"
                            onClick={() => {
                                draftRevisionRef.current += 1;
                                valueRef.current = '';
                                setValue('');
                                onInputChange?.('');
                                draftRecovery.clear();
                                setShowRecoveredHint(false);
                            }}
                        >
                            Discard
                        </button>
                    </div>
                )}
                {draftRecovery.saveWarning && (
                    <p className="mt-1 px-1 text-xs text-muted-foreground" role="status" aria-live="polite">
                        {draftRecovery.saveWarning}
                    </p>
                )}
            </div>
        </div>
    );
});
ChatInput.displayName = 'ChatInput';
