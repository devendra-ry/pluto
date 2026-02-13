'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { ChatMessage } from '@/components/chat-message';
import { ChatInput, type ChatInputHandle, type ChatSubmitOptions } from '@/components/chat-input';
import { type Attachment, type ReasoningEffort } from '@/lib/types';
import { useThread, updateThreadTitle, updateThreadModel, touchThread, updateReasoningEffort } from '@/hooks/use-threads';
import { useMessages, addMessage, deleteMessagesByIds, getThreadMessages } from '@/hooks/use-messages';
import { DEFAULT_MODEL, AVAILABLE_MODELS, SUGGESTED_PROMPTS, CATEGORIES, DEFAULT_REASONING_EFFORT, IMAGE_GENERATION_MODEL, PENDING_GENERATION_MODEL_KEY, PENDING_GENERATION_THREAD_KEY } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Wand2, BookOpen, Code, GraduationCap, ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatPageClientProps {
    chatId: string;
}

interface ChatMessageType {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments?: Attachment[];
    reasoning?: string;
    model_id?: string;
}

function isAttachment(value: unknown): value is Attachment {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.id === 'string' &&
        typeof record.name === 'string' &&
        typeof record.mimeType === 'string' &&
        typeof record.size === 'number' &&
        typeof record.path === 'string' &&
        typeof record.url === 'string'
    );
}

// Regex to fix markdown headings without space after #
const HEADING_FIX_REGEX = /^(#{1,6})([^#\s])/gm;

// Map icon names to components
const ICON_MAP: Record<string, LucideIcon> = {
    Wand2,
    BookOpen,
    Code,
    GraduationCap,
};

function isSelectableChatModel(modelId: string): boolean {
    const modelConfig = AVAILABLE_MODELS.find((m) => m.id === modelId);
    if (!modelConfig) return false;
    return !modelConfig.hidden && !modelConfig.capabilities.includes('imageGen');
}

export function ChatPageClient({ chatId }: ChatPageClientProps) {
    const thread = useThread(chatId);
    const storedMessages = useMessages(chatId);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [model, setModel] = useState<string>(DEFAULT_MODEL);
    const chatInputRef = useRef<ChatInputHandle>(null);
    const [messages, setMessages] = useState<ChatMessageType[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const hasInitialized = useRef(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const generatingRef = useRef<string | null>(null);
    const lastRequestFailed = useRef(false); // Prevent auto-retry after failures
    const currentMessagesChatId = useRef<string | null>(null);
    const justAddedMessageIdRef = useRef<string | null>(null);
    const { showToast } = useToast();

    useEffect(() => {
        if (thread?.model && isSelectableChatModel(thread.model)) {
            setModel(thread.model);
        }
        if (thread?.reasoning_effort) {
            setReasoningEffort(thread.reasoning_effort);
        }
    }, [thread]);

    useEffect(() => {
        if (storedMessages === undefined) return;

        // Reset if we've switched chats
        if (hasInitialized.current && storedMessages && storedMessages.length === 0 && messages.length > 0) {
            setMessages([]);
            hasInitialized.current = false;
        }

        if (!hasInitialized.current && storedMessages) {
            hasInitialized.current = true;
            currentMessagesChatId.current = chatId;
            setMessages(
                storedMessages.map((m) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    attachments: m.attachments ?? [],
                    reasoning: m.reasoning,
                    model_id: m.model_id,
                }))
            );
        } else {
            // Update messages if they change after initialization (e.g. from sync or outside update)
            // But only if we aren't currently generating to avoid race conditions with local state
            if (!isLoading && !isThinking && storedMessages) {
                // If we just added a message, wait for it to appear in storedMessages before syncing
                // This prevents the UI from reverting to a previous state and causing a loop
                if (justAddedMessageIdRef.current) {
                    const found = storedMessages.find(m => m.id === justAddedMessageIdRef.current);
                    if (!found) {
                        return;
                    }
                    justAddedMessageIdRef.current = null;
                }

                currentMessagesChatId.current = chatId;
                setMessages(
                    storedMessages.map((m) => ({
                        id: m.id,
                        role: m.role,
                        content: m.content,
                        attachments: m.attachments ?? [],
                        reasoning: m.reasoning,
                        model_id: m.model_id,
                    }))
                );
            }
        }
    }, [storedMessages, isLoading, isThinking, messages.length, chatId]);


    useEffect(() => {
        // Prepare for new chat ID
        lastRequestFailed.current = false;
        hasInitialized.current = false;
        currentMessagesChatId.current = null;

        // Immediately clear messages to provide an "instant" wipe feel
        setMessages([]);

        if (chatInputRef.current) {
            chatInputRef.current.setValue('');
        }
        setIsLoading(false);
        setIsThinking(false);
        generatingRef.current = null;
        setReasoningEffort(DEFAULT_REASONING_EFFORT);
        setIsAtBottom(true);
    }, [chatId]);

    const scrollToBottom = useCallback(() => {
        if (virtuosoRef.current) {
            virtuosoRef.current.scrollToIndex({ index: messages.length - 1, align: 'end', behavior: 'smooth' });
            setIsAtBottom(true);
        }
    }, [messages.length]);

    useEffect(() => {
        if (virtuosoRef.current && isAtBottom) {
            virtuosoRef.current.scrollToIndex({ index: messages.length - 1, align: 'end' });
        }
    }, [messages.length, isThinking, isAtBottom]); // Optimized dependency


    const handleModelChange = async (newModel: string) => {
        if (!isSelectableChatModel(newModel)) {
            return;
        }
        setModel(newModel);
        await updateThreadModel(chatId, newModel);
    };

    const handleReasoningEffortChange = async (effort: ReasoningEffort) => {
        setReasoningEffort(effort);
        await updateReasoningEffort(chatId, effort);
    };

    const handleStop = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
    }, []);

    const generateResponse = useCallback(async (currentMessages: ChatMessageType[], forcedModelId?: string) => {
        const lastMsg = currentMessages[currentMessages.length - 1];
        if (!lastMsg || lastMsg.role !== 'user') return;
        if (generatingRef.current === lastMsg.id) return;
        generatingRef.current = lastMsg.id;

        const activeModelId = forcedModelId || model;
        const selectedModel = AVAILABLE_MODELS.find(m => m.id === activeModelId);
        const isImageGenModel = activeModelId === IMAGE_GENERATION_MODEL;
        const supportsReasoning = isImageGenModel ? false : (selectedModel?.supportsReasoning ?? true);

        const willThink = supportsReasoning && !(selectedModel?.usesThinkingParam && reasoningEffort === 'low');

        const assistantMsgId = crypto.randomUUID();
        const assistantMsg: ChatMessageType = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            reasoning: '',
            model_id: activeModelId,
        };
        setMessages(prev => [...prev, assistantMsg]);

        setIsThinking(!isImageGenModel && willThink);
        setIsLoading(true);
        abortControllerRef.current = new AbortController();

        const updateTitleIfNeeded = async () => {
            const currentThread = thread;
            if (currentThread?.title === 'New Chat' && currentMessages.length > 0) {
                const firstUserMsg = currentMessages.find(m => m.role === 'user');
                if (firstUserMsg) {
                    const attachmentTitle = firstUserMsg.attachments?.[0]?.name ? `Attachment: ${firstUserMsg.attachments[0].name}` : 'New Chat';
                    const baseTitle = firstUserMsg.content.trim() || attachmentTitle;
                    const title = baseTitle.slice(0, 50) + (baseTitle.length > 50 ? '...' : '');
                    updateThreadTitle(chatId, title);
                }
            }
        };
        void updateTitleIfNeeded();

        let fullContent = '';
        let fullReasoning = '';
        const persistAssistantMessage = async (
            content: string,
            reasoning?: string,
            attachments: Attachment[] = []
        ) => {
            if (!content && !reasoning && attachments.length === 0) {
                return false;
            }

            const newMsg = await addMessage(chatId, 'assistant', content, reasoning, activeModelId, attachments);
            setMessages(prev =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, id: newMsg.id } : m))
            );
            justAddedMessageIdRef.current = newMsg.id;
            await touchThread(chatId);
            return true;
        };

        try {
            if (isImageGenModel) {
                const response = await fetch('/api/images', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        threadId: chatId,
                        prompt: lastMsg.content,
                    }),
                    signal: abortControllerRef.current.signal,
                });

                const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
                if (!response.ok) {
                    const errorMessage =
                        typeof payload.error === 'string'
                            ? payload.error
                            : 'Failed to generate image';
                    throw new Error(errorMessage);
                }

                const attachment = isAttachment(payload.attachment) ? payload.attachment : null;
                if (!attachment) {
                    throw new Error('Image generation did not return a valid attachment');
                }

                const revisedPrompt = typeof payload.revisedPrompt === 'string'
                    ? payload.revisedPrompt.trim()
                    : '';
                const assistantContent = revisedPrompt
                    ? `Generated image.\nPrompt rewrite: ${revisedPrompt}`
                    : 'Generated image.';

                setMessages((prev) => {
                    const updated = [...prev];
                    const msgIdx = updated.findIndex(m => m.id === assistantMsgId);
                    if (msgIdx !== -1) {
                        updated[msgIdx] = {
                            ...updated[msgIdx],
                            content: assistantContent,
                            attachments: [attachment],
                            model_id: activeModelId,
                        };
                    }
                    return updated;
                });

                const persisted = await persistAssistantMessage(assistantContent, undefined, [attachment]);
                if (!persisted) {
                    throw new Error('Failed to persist generated image');
                }
                return;
            }

            const decoder = new TextDecoder();
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: currentMessages.map((m) => ({
                        role: m.role,
                        content: m.content,
                        attachments: m.attachments ?? [],
                    })),
                    model: activeModelId,
                    reasoningEffort,
                }),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                throw new Error('Failed to get response');
            }

            const reader = response.body?.getReader();

            if (reader) {
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') continue;

                            try {
                                const parsed = JSON.parse(data);
                                const delta = parsed.choices?.[0]?.delta;

                                // Check for reasoning content (some models use reasoning_content)
                                const reasoningContent = delta?.reasoning_content || delta?.thinking || '';
                                if (reasoningContent && supportsReasoning) {
                                    fullReasoning += reasoningContent;
                                    setMessages((prev) => {
                                        const updated = [...prev];
                                        const msgIdx = updated.findIndex(m => m.id === assistantMsgId);
                                        if (msgIdx !== -1) {
                                            updated[msgIdx] = {
                                                ...updated[msgIdx],
                                                reasoning: fullReasoning,
                                                model_id: activeModelId,
                                            };
                                        }
                                        return updated;
                                    });
                                    // Still thinking while we have reasoning content
                                    setIsThinking(true);
                                }

                                // Check for main content
                                const content = delta?.content || '';
                                if (content) {
                                    // Once we get main content, thinking is done
                                    setIsThinking(false);
                                    fullContent += content;
                                    setMessages((prev) => {
                                        const updated = [...prev];
                                        const msgIdx = updated.findIndex(m => m.id === assistantMsgId);
                                        if (msgIdx !== -1) {
                                            updated[msgIdx] = {
                                                ...updated[msgIdx],
                                                content: fullContent,
                                                reasoning: fullReasoning,
                                                model_id: activeModelId,
                                            };
                                        }
                                        return updated;
                                    });
                                }
                            } catch {
                                // Skip malformed JSON
                            }
                        }
                    }
                }
            }

            const persisted = await persistAssistantMessage(fullContent, fullReasoning);
            if (!persisted) {
                setMessages(currentMessages);
                lastRequestFailed.current = true;
                showToast('No response returned. Please try again.', 'error');
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                if (isImageGenModel) {
                    setMessages(currentMessages);
                    return;
                }
                const persisted = await persistAssistantMessage(fullContent, fullReasoning);
                if (!persisted) {
                    lastRequestFailed.current = true;
                    setMessages(currentMessages);
                }
            } else {
                console.error('Chat error:', error);
                const errorMessage = error instanceof Error
                    ? error.message
                    : 'Failed to generate response. Please try again.';
                showToast(errorMessage, 'error');
                // Remove the empty assistant message if it failed
                setMessages(currentMessages);
                // Mark that the last request failed to prevent auto-retry
                lastRequestFailed.current = true;
            }
        } finally {
            setIsLoading(false);
            setIsThinking(false);
            generatingRef.current = null;
            abortControllerRef.current = null;
        }
    }, [chatId, model, reasoningEffort, thread, showToast]);

    // Check for pending user message on load (e.g. new chat from home)
    useEffect(() => {
        // Don't auto-retry if the last request failed or if messages don't belong to current chat
        if (lastRequestFailed.current || currentMessagesChatId.current !== chatId) {
            return;
        }
        if (hasInitialized.current && messages.length > 0 && !isLoading && !isThinking) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'user') {
                const pendingGenerationThreadId = window.sessionStorage.getItem(PENDING_GENERATION_THREAD_KEY);
                if (pendingGenerationThreadId !== chatId) {
                    return;
                }
                const pendingGenerationModelId = window.sessionStorage.getItem(PENDING_GENERATION_MODEL_KEY);
                window.sessionStorage.removeItem(PENDING_GENERATION_THREAD_KEY);
                window.sessionStorage.removeItem(PENDING_GENERATION_MODEL_KEY);
                if (pendingGenerationModelId === IMAGE_GENERATION_MODEL) {
                    generateResponse(messages, IMAGE_GENERATION_MODEL);
                    return;
                }
                generateResponse(messages);
            }
        }
    }, [messages, isLoading, isThinking, generateResponse, chatId]);

    const sendMessage = useCallback(async (
        userMessage: string,
        attachments: Attachment[],
        existingMessages: ChatMessageType[],
        options: ChatSubmitOptions
    ) => {
        setIsLoading(true);
        // Reset the failure flag when user manually sends a message
        lastRequestFailed.current = false;
        const targetModel = options.mode === 'image' ? IMAGE_GENERATION_MODEL : model;

        const userMsg: ChatMessageType = {
            id: crypto.randomUUID(),
            role: 'user',
            content: userMessage,
            attachments,
        };

        const updatedMessages = [...existingMessages, userMsg];
        setMessages(updatedMessages);

        try {
            const persistedUser = await addMessage(chatId, 'user', userMessage, undefined, undefined, attachments);
            const persistedMessages = updatedMessages.map((m) =>
                m.id === userMsg.id ? { ...m, id: persistedUser.id } : m
            );
            setMessages(persistedMessages);
            await generateResponse(persistedMessages, targetModel);
            return true;
        } catch (error) {
            setIsLoading(false);
            console.error('Failed to send message:', error);
            showToast('Failed to send message. Please try again.', 'error');
            return false;
        }
    }, [chatId, generateResponse, showToast, model]);

    const handleSend = useCallback(async (value: string, attachments: Attachment[], options: ChatSubmitOptions) => {
        if ((!value.trim() && attachments.length === 0) || isLoading) return false;
        setIsAtBottom(true);
        return sendMessage(value, attachments, messages, options);
    }, [isLoading, messages, sendMessage]);

    const handlePromptClick = (prompt: string) => {
        if (chatInputRef.current) {
            chatInputRef.current.setValue(prompt);
            chatInputRef.current.focus();
        }
    };

    const handleEdit = useCallback(async (messageId: string, newContent: string) => {
        setIsLoading(true);
        const localMessages = messages;
        const msgIndex = localMessages.findIndex(m => m.id === messageId);
        if (msgIndex === -1) {
            setIsLoading(false);
            return;
        }
        const editedMessageAttachments = localMessages[msgIndex].attachments ?? [];

        const anchorBeforeEditId = msgIndex > 0 ? localMessages[msgIndex - 1].id : null;
        try {
            const canonicalMessages = await getThreadMessages(chatId);
            const anchorDbIndex = anchorBeforeEditId
                ? canonicalMessages.findIndex((m) => m.id === anchorBeforeEditId)
                : -1;

            const deleteStartIndex = anchorBeforeEditId ? anchorDbIndex + 1 : 0;
            if (anchorBeforeEditId && anchorDbIndex === -1) {
                setIsLoading(false);
                showToast('Edit failed to align with saved history. Refresh and try again.', 'error');
                return;
            }

            const deleteIds = canonicalMessages.slice(deleteStartIndex).map((m) => m.id);
            await deleteMessagesByIds(deleteIds);

            const persistedUser = await addMessage(chatId, 'user', newContent, undefined, undefined, editedMessageAttachments);

            // Refetch canonical state after delete + insert so generation starts from DB truth.
            const refreshedMessages = await getThreadMessages(chatId);
            const updatedMessages: ChatMessageType[] = refreshedMessages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                attachments: m.attachments ?? [],
                reasoning: m.reasoning,
                model_id: m.model_id,
            }));

            setMessages(updatedMessages);
            if (persistedUser.id) {
                justAddedMessageIdRef.current = persistedUser.id;
            }

            await generateResponse(updatedMessages);
        } catch (error) {
            setIsLoading(false);
            console.error('Failed to edit message:', error);
            showToast('Failed to edit message history. Please try again.', 'error');
        }
    }, [messages, chatId, showToast, generateResponse]);

    const handleRetry = useCallback(async (messageId: string) => {
        setIsLoading(true);
        const localMessages = messages;
        let msgIndex = localMessages.findIndex(m => m.id === messageId);
        if (msgIndex === -1) {
            setIsLoading(false);
            return;
        }

        // If retrying an assistant message, find the preceding user message
        if (localMessages[msgIndex].role === 'assistant') {
            msgIndex = localMessages.slice(0, msgIndex).findLastIndex(m => m.role === 'user');
            if (msgIndex === -1) {
                setIsLoading(false);
                return;
            }
        } else if (localMessages[msgIndex].role !== 'user') {
            setIsLoading(false);
            return;
        }

        const anchorMessageId = localMessages[msgIndex].id;

        try {
            const canonicalMessages = await getThreadMessages(chatId);
            const anchorDbIndex = canonicalMessages.findIndex((m) => m.id === anchorMessageId);
            if (anchorDbIndex === -1) {
                setIsLoading(false);
                showToast('Retry failed to align with saved history. Refresh and try again.', 'error');
                return;
            }

            const deleteIds = canonicalMessages.slice(anchorDbIndex + 1).map((m) => m.id);
            await deleteMessagesByIds(deleteIds);

            // Refetch canonical state after delete so we regenerate from DB truth.
            const refreshedMessages = await getThreadMessages(chatId);
            const previousMessages: ChatMessageType[] = refreshedMessages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                attachments: m.attachments ?? [],
                reasoning: m.reasoning,
                model_id: m.model_id,
            }));

            setMessages(previousMessages);
            await generateResponse(previousMessages);
        } catch (error) {
            setIsLoading(false);
            console.error('Failed to retry message:', error);
            showToast('Failed to delete previous responses. Please try again.', 'error');
        }
    }, [messages, chatId, showToast, generateResponse]);

    return (
        <div className="flex flex-col h-full bg-[#1a1520]">


            <div className="flex-1 min-h-0 relative">
                {storedMessages === null || (storedMessages && storedMessages.length > 0 && messages.length === 0) ? (
                    null // Render nothing while loading or syncing for an "instant" feel
                ) : (storedMessages && storedMessages.length === 0 && !isThinking) ? (
                    <div className="flex flex-col items-center justify-center h-full px-4 pt-8">
                        {/* Main heading */}
                        <h1 className="text-2xl md:text-3xl font-bold text-zinc-100 mb-6 text-center">
                            How can I help you?
                        </h1>

                        {/* Category buttons */}
                        <div className="flex flex-wrap justify-center gap-2 mb-8">

                            {CATEGORIES.map((cat) => {
                                const IconComponent = ICON_MAP[cat.icon];
                                return (
                                    <Button
                                        key={cat.label}
                                        variant="ghost"
                                        className="h-9 px-4 gap-2 text-zinc-400 bg-transparent hover:bg-[#2a2035] border border-[#3a3045] rounded-full text-[15px]"
                                    >
                                        <IconComponent className="h-4 w-4" />
                                        {cat.label}
                                    </Button>
                                );
                            })}
                        </div>

                        {/* Suggested prompts */}
                        <div className="space-y-1 w-full max-w-md text-left">
                            {SUGGESTED_PROMPTS.map((prompt, i) => (
                                <button
                                    key={i}
                                    onClick={() => handlePromptClick(prompt)}
                                    className="w-full text-left px-1 py-2 text-base text-pink-300/80 hover:text-pink-200 transition-colors"
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>

                        {/* Terms and Privacy Policy (at bottom) */}
                        <div className="absolute bottom-12 left-0 right-0 text-center">
                            <p className="text-xs text-zinc-500">
                                Make sure you agree to our{' '}
                                <span className="underline cursor-pointer hover:text-zinc-400">Terms</span>
                                {' '}and our{' '}
                                <span className="underline cursor-pointer hover:text-zinc-400">Privacy Policy</span>
                            </p>
                        </div>
                    </div>
                ) : (
                    <Virtuoso
                        ref={virtuosoRef}
                        className="scrollbar-none"
                        data={messages}
                        followOutput="auto"
                        atBottomThreshold={60}
                        atBottomStateChange={setIsAtBottom}
                        initialTopMostItemIndex={messages.length - 1}
                        itemContent={(index, message) => {
                            const messageModelId = message.model_id || (message.role === 'assistant' ? model : undefined);
                            const selectedModel = AVAILABLE_MODELS.find((m) => m.id === messageModelId);
                            return (
                                <div className={cn("max-w-3xl mx-auto", index === 0 ? "pt-12" : "pt-4")}>
                                    <ChatMessage
                                        key={message.id}
                                        id={message.id}
                                        role={message.role}
                                        content={message.content.replace(HEADING_FIX_REGEX, '$1 $2')}
                                        attachments={message.attachments}
                                        reasoning={message.reasoning}
                                        isStreaming={isLoading && index === messages.length - 1 && message.role === 'assistant'}
                                        isThinking={isThinking && index === messages.length - 1 && message.role === 'assistant'}
                                        modelName={message.role === 'assistant' ? selectedModel?.name : undefined}
                                        onEdit={message.role === 'user' ? handleEdit : undefined}
                                        onRetry={handleRetry}
                                    />
                                </div>
                            );
                        }}
                    />
                )}
            </div>

            <div className="relative w-full max-w-3xl mx-auto px-4">
                {/* Floating Scroll to Bottom Button - Pill Style */}
                {!isAtBottom && messages.length > 0 && (
                    <div className="absolute -top-14 left-1/2 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <button
                            onClick={scrollToBottom}
                            className="h-9 px-4 rounded-full bg-zinc-900/60 backdrop-blur-lg border border-white/5 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/80 shadow-2xl transition-all flex items-center gap-2 group"
                        >
                            <span className="text-sm font-semibold tracking-tight">Scroll to bottom</span>
                            <ChevronDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                        </button>
                    </div>
                )}
            </div>

            <ChatInput
                ref={chatInputRef}
                onSubmit={handleSend}
                threadId={chatId}
                onStop={handleStop}
                isLoading={isLoading}
                currentModel={model}
                onModelChange={handleModelChange}
                reasoningEffort={reasoningEffort}
                onReasoningEffortChange={handleReasoningEffortChange}
            />
        </div>
    );
}
