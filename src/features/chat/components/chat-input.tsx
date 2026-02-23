'use client';

import { useRef, useEffect, forwardRef, useState, useImperativeHandle, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowUp, Square, Paperclip } from 'lucide-react';
import { AVAILABLE_MODELS, IMAGE_GENERATION_MODEL, SEARCH_ENABLED_MODELS, isImageGenerationModel } from '@/shared/core/constants';
import { type Attachment, type ReasoningEffort } from '@/shared/core/types';
import { ModelSelector } from '@/features/chat/components/model-selector';
import { MAX_ATTACHMENTS_PER_MESSAGE, isImageAttachment, isPdfAttachment, isSupportedAttachmentMimeType, isTextAttachment } from '@/features/attachments/lib/attachments';
import { startUploadFileForThread } from '@/features/uploads/lib/uploads';
import { useToast } from '@/components/ui/toast';
import { scheduleFrame } from '@/shared/lib/animation-frame';
import { ChatSubmitMode, ChatSubmitOptions, LocalAttachmentItem, ChatInputHandle, LocalAttachmentStatus } from './chat-input/chat-input-types';
import { AttachmentList } from './chat-input/attachment-list';
import { ModeSelector } from './chat-input/mode-selector';
import { ReasoningSelector } from './chat-input/reasoning-selector';
import { SystemPromptSelector } from './chat-input/system-prompt-selector';

// Re-export types for backward compatibility
export type { ChatSubmitMode, ChatSubmitOptions, LocalAttachmentItem, ChatInputHandle, LocalAttachmentStatus };

interface ChatInputProps {
    initialValue?: string;
    onInputChange?: (value: string) => void;
    onSubmit: (
        value: string,
        attachments: Attachment[],
        options: ChatSubmitOptions
    ) => Promise<boolean | void> | boolean | void;
    onEnsureThread?: () => Promise<string>;
    threadId?: string | null;
    onStop?: () => void;
    isLoading: boolean;
    currentModel: string;
    onModelChange: (model: string) => void;
    reasoningEffort: ReasoningEffort;
    onReasoningEffortChange: (effort: ReasoningEffort) => void;
    systemPrompt?: string;
    onSystemPromptChange?: (prompt: string) => Promise<void> | void;
}

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
    systemPrompt = '',
    onSystemPromptChange,
}, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadTasksRef = useRef<Map<string, () => void>>(new Map());
    const valueRef = useRef(initialValue);
    const attachmentItemsRef = useRef<LocalAttachmentItem[]>([]);
    const [value, setValue] = useState(initialValue);
    const [isImageMode, setIsImageMode] = useState(false);
    const [isImageEditMode, setIsImageEditMode] = useState(false);
    const [isVideoMode, setIsVideoMode] = useState(false);
    const [isSearchMode, setIsSearchMode] = useState(false);
    const [selectedImageModelId, setSelectedImageModelId] = useState(IMAGE_GENERATION_MODEL);
    const isImageModeRef = useRef(false);
    const isImageEditModeRef = useRef(false);
    const isVideoModeRef = useRef(false);
    const isSearchModeRef = useRef(false);
    const selectedImageModelIdRef = useRef(IMAGE_GENERATION_MODEL);
    const [attachmentItems, setAttachmentItems] = useState<LocalAttachmentItem[]>([]);
    const { showToast } = useToast();
    const selectedModel = AVAILABLE_MODELS.find((m) => m.id === currentModel) ?? AVAILABLE_MODELS[0];
    const supportsSearchMode = SEARCH_ENABLED_MODELS.includes(currentModel as typeof SEARCH_ENABLED_MODELS[number]);
    const isOpenRouterModel = selectedModel.provider === 'openrouter';
    const supportsImages = !isOpenRouterModel && selectedModel.capabilities.includes('vision');
    const supportsPdfs = !isOpenRouterModel && (selectedModel.capabilities.includes('pdf') || selectedModel.provider === 'google');
    const supportsTexts = !isOpenRouterModel && selectedModel.provider === 'google';
    const supportsImageUploads = isImageEditMode || isVideoMode || supportsImages;
    const supportsAttachments = isImageEditMode || isVideoMode || (!isImageMode && (supportsImages || supportsPdfs || supportsTexts));
    const activeAttachmentItems = useMemo(
        () => (supportsAttachments ? attachmentItems : []),
        [supportsAttachments, attachmentItems]
    );
    const acceptedMimeTypes = (isImageEditMode || isVideoMode)
        ? 'image/png,image/jpeg,image/webp,image/gif'
        : [
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

    const activeMode: ChatSubmitMode = isImageMode
        ? 'image'
        : isImageEditMode
        ? 'image-edit'
        : isVideoMode
        ? 'video'
        : isSearchMode
        ? 'search'
        : 'chat';

    useEffect(() => {
        if (!supportsSearchMode && isSearchMode) {
            isSearchModeRef.current = false;
            setIsSearchMode(false);
            showToast('Search is available only for Gemini 2.5 Flash and Gemini 2.5 Flash Lite', 'error');
        }
    }, [supportsSearchMode, isSearchMode, showToast]);

    const getSubmitMode = useCallback<() => ChatSubmitMode>(() => {
        if (isImageModeRef.current) return 'image';
        if (isImageEditModeRef.current) return 'image-edit';
        if (isVideoModeRef.current) return 'video';
        if (isSearchModeRef.current) return 'search';
        return 'chat';
    }, []);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
        }
        valueRef.current = value;
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

    useEffect(() => {
        attachmentItemsRef.current = attachmentItems;
    }, [attachmentItems]);

    useEffect(() => {
        selectedImageModelIdRef.current = selectedImageModelId;
    }, [selectedImageModelId]);

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
        const submitMode = getSubmitMode();
        if (submitMode === 'image-edit' && uploadedAttachments.length === 0) {
            showToast('Attach at least one image for Image Edit mode', 'error');
            return;
        }
        if (submitMode === 'image-edit' && !value.trim()) {
            showToast('Enter an edit prompt for Image Edit mode', 'error');
            return;
        }
        if (submitMode === 'video' && uploadedAttachments.length === 0) {
            showToast('Attach an image for Image to Video mode', 'error');
            return;
        }
        if (submitMode === 'video' && !value.trim()) {
            showToast('Enter an animation prompt for Image to Video mode', 'error');
            return;
        }
        if ((!value.trim() && uploadedAttachments.length === 0) || hasUploadingAttachments || hasFailedAttachments || isLoading) {
            return;
        }

        const submittedValue = value;
        const submittedItems = attachmentItems;
        const submittedAttachments = uploadedAttachments;

        // Clear immediately so user can start typing the next prompt while generation runs.
        setValue('');
        onInputChange?.('');
        setAttachmentItems([]);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }

        try {
            const submitted = await onSubmit(submittedValue, submittedAttachments, {
                mode: submitMode,
                imageModelId: submitMode === 'image' || submitMode === 'image-edit'
                    ? selectedImageModelIdRef.current
                    : undefined,
            });
            if (submitted === false) {
                // Restore only if user has not started drafting a new message yet.
                if (valueRef.current.trim().length === 0 && attachmentItemsRef.current.length === 0) {
                    setValue(submittedValue);
                    onInputChange?.(submittedValue);
                    setAttachmentItems(submittedItems);
                    if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                    }
                }
                return;
            }
        } catch (error) {
            if (process.env.NODE_ENV !== 'production') {
                console.warn('[chat-input] Submit failed, restoring local draft state', error);
            }
            // Parent handles toast/error feedback.
            // Restore only if user has not started drafting a new message yet.
            if (valueRef.current.trim().length === 0 && attachmentItemsRef.current.length === 0) {
                setValue(submittedValue);
                onInputChange?.(submittedValue);
                setAttachmentItems(submittedItems);
                if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                }
            }
        }
    };

    const setMode = useCallback((mode: ChatSubmitMode) => {
        if (mode === activeMode) return;
        if (mode === 'search' && !supportsSearchMode) {
            showToast('Search is available only for Gemini 2.5 Flash and Gemini 2.5 Flash Lite', 'error');
            return;
        }
        if (mode === 'search' && isLoading) return;

        const nextImage = mode === 'image';
        const nextImageEdit = mode === 'image-edit';
        const nextVideo = mode === 'video';
        const nextSearch = mode === 'search';

        isImageModeRef.current = nextImage;
        setIsImageMode(nextImage);
        isImageEditModeRef.current = nextImageEdit;
        setIsImageEditMode(nextImageEdit);
        isVideoModeRef.current = nextVideo;
        setIsVideoMode(nextVideo);
        isSearchModeRef.current = nextSearch;
        setIsSearchMode(nextSearch);

        if (nextImage || nextImageEdit || nextVideo) {
            const tasks = uploadTasksRef.current;
            for (const cancel of tasks.values()) {
                cancel();
            }
            tasks.clear();
            setAttachmentItems([]);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    }, [activeMode, supportsSearchMode, showToast, isLoading]);

    const setImageModelId = useCallback((modelId: string) => {
        if (!isImageGenerationModel(modelId)) return;
        selectedImageModelIdRef.current = modelId;
        setSelectedImageModelId(modelId);
    }, []);

    useImperativeHandle(ref, () => ({
        setValue: (newValue: string) => {
            setValue(newValue);
            scheduleFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.style.height = 'auto';
                    textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
                }
            });
        },
        focus: () => textareaRef.current?.focus(),
        setMode: (mode: ChatSubmitMode) => setMode(mode),
        setImageModelId: (modelId: string) => setImageModelId(modelId),
        getMode: () => getSubmitMode(),
        getImageModelId: () => selectedImageModelIdRef.current,
    }), [getSubmitMode, setImageModelId, setMode]);

    const handleAttachClick = () => {
        if (isLoading || !supportsAttachments) return;
        fileInputRef.current?.click();
    };

    const enqueueLocalFiles = useCallback((files: File[], source: 'picker' | 'paste') => {
        if (files.length === 0) return;
        if (!supportsAttachments) {
            showToast('Attachments are not supported for the current mode/model', 'error');
            return;
        }

        const maxAttachmentsForMode = isVideoModeRef.current ? 1 : MAX_ATTACHMENTS_PER_MESSAGE;
        const availableSlots = Math.max(0, maxAttachmentsForMode - activeAttachmentItems.length);
        const selectedFiles = files.slice(0, availableSlots);
        if (selectedFiles.length === 0) {
            if (isVideoModeRef.current) {
                showToast('Image to Video mode supports exactly one image attachment', 'error');
            } else {
                showToast(`Maximum ${MAX_ATTACHMENTS_PER_MESSAGE} attachments allowed per message`, 'error');
            }
            return;
        }

        const nextItems: LocalAttachmentItem[] = selectedFiles.map((file) => {
            const localId = crypto.randomUUID();
            const mimeType = file.type || '';
            const isKnownType = isSupportedAttachmentMimeType(mimeType);
            const isAllowedType =
                (isImageEditModeRef.current || isVideoModeRef.current)
                    ? isImageAttachment(mimeType)
                    : (
                        (isImageAttachment(mimeType) && supportsImages) ||
                        (isPdfAttachment(mimeType) && supportsPdfs) ||
                        (isTextAttachment(mimeType) && supportsTexts)
                    );

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

        if (files.length > selectedFiles.length) {
            const addedCount = selectedFiles.length;
            showToast(
                isVideoModeRef.current
                    ? 'Image to Video mode accepts only one image; extra files were ignored'
                    : (
                        source === 'paste'
                            ? `Only ${addedCount} pasted image(s) were added due to attachment limit`
                            : `Only ${addedCount} file(s) were added due to attachment limit`
                    ),
                'error'
            );
        }
    }, [
        supportsAttachments,
        activeAttachmentItems.length,
        supportsImages,
        supportsPdfs,
        supportsTexts,
        uploadLocalFile,
        showToast,
    ]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        enqueueLocalFiles(files, 'picker');
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
            showToast('Pasted images are not supported for the current mode/model', 'error');
            return;
        }

        enqueueLocalFiles(pastedImageFiles, 'paste');
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
                        onPaste={handlePaste}
                        placeholder={
                            isImageMode
                                ? 'Describe the image you want to generate...'
                                : (
                                    isImageEditMode
                                        ? 'Describe how you want to edit the attached image(s)...'
                                        : (
                                            isVideoMode
                                                ? 'Describe how the attached image should animate...'
                                                : (isSearchMode ? 'Ask anything with web search...' : 'Type your message here...')
                                        )
                                )
                        }
                        className="w-full px-5 pt-4 pb-3 bg-transparent text-zinc-100 placeholder:text-zinc-500/80 focus:outline-none resize-none min-h-[60px] text-base leading-relaxed overflow-y-auto"
                    />

                    <AttachmentList
                        items={activeAttachmentItems}
                        onRemove={handleRemoveAttachment}
                        onRetry={handleRetryAttachment}
                    />

                    <div className="flex items-center justify-between gap-2 px-3 md:px-4 pb-3 pt-1">
                        <div className="flex min-w-0 items-center gap-1.5 md:gap-3">
                            <div className="shrink-0">
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

                            <ModeSelector
                                activeMode={activeMode}
                                supportsSearchMode={supportsSearchMode}
                                isLoading={isLoading}
                                onModeChange={setMode}
                                selectedImageModelId={selectedImageModelId}
                                onImageModelChange={setImageModelId}
                            />

                            <SystemPromptSelector
                                systemPrompt={systemPrompt}
                                onSystemPromptChange={onSystemPromptChange}
                            />

                            <div className="group/attach relative flex shrink-0 flex-col items-center">
                                <Button
                                    variant="ghost"
                                    type="button"
                                    onClick={handleAttachClick}
                                    disabled={
                                        isLoading
                                        || !supportsAttachments
                                        || activeAttachmentItems.length >= (isVideoMode ? 1 : MAX_ATTACHMENTS_PER_MESSAGE)
                                    }
                                    className="h-8 w-8 md:w-11 p-0 text-[#fce7ef] hover:text-white bg-[#2a2035]/30 hover:bg-[#2a2035]/50 border border-white/10 rounded-xl md:rounded-full transition-all flex items-center justify-center"
                                >
                                    <Paperclip className="h-3.5 w-3.5 md:h-4 md:w-4" />
                                </Button>

                                <div className="absolute bottom-full mb-2 hidden group-hover/attach:block z-50 pointer-events-none">
                                    <div className="bg-[#1a1520]/95 backdrop-blur-md text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/10 font-semibold tracking-tight animate-in fade-in zoom-in-95 duration-200">
                                        <span className="text-[#fce7ef]">
                                            {isImageMode
                                                ? 'Attachments are disabled in Image mode'
                                                : isImageEditMode
                                                ? 'Attach one or more images to edit'
                                                : isVideoMode
                                                ? 'Attach one image to animate'
                                                : supportsAttachments
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
                                className="shrink-0 h-8 w-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all border border-red-500/20"
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
                                className="shrink-0 h-8 w-8 rounded-lg bg-[#3a283e] hover:bg-[#4a354e] text-pink-300/80 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
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