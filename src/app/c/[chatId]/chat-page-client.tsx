'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ChatMessage } from '@/components/chat-message';
import { ChatInput } from '@/components/chat-input';
import { type ReasoningEffort } from '@/lib/types';
import { ChatLayout } from '@/components/chat-layout';
import { useThread, updateThreadTitle, updateThreadModel, touchThread, updateReasoningEffort } from '@/hooks/use-threads';
import { useMessages, addMessage, deleteMessage } from '@/hooks/use-messages';
import { DEFAULT_MODEL, AVAILABLE_MODELS, SUGGESTED_PROMPTS, CATEGORIES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Wand2, BookOpen, Code, GraduationCap, Settings, ChevronDown, type LucideIcon } from 'lucide-react';

interface ChatPageClientProps {
    chatId: string;
}

interface ChatMessageType {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
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

export function ChatPageClient({ chatId }: ChatPageClientProps) {
    const thread = useThread(chatId);
    const storedMessages = useMessages(chatId);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [model, setModel] = useState<string>(DEFAULT_MODEL);
    const [inputValue, setInputValue] = useState('');
    const [messages, setMessages] = useState<ChatMessageType[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('low');
    const [isAtBottom, setIsAtBottom] = useState(true);
    const hasInitialized = useRef(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const generatingRef = useRef<string | null>(null);
    const lastRequestFailed = useRef(false); // Prevent auto-retry after failures
    const { showToast } = useToast();

    useEffect(() => {
        if (thread?.model) {
            setModel(thread.model);
        }
        setReasoningEffort(thread?.reasoningEffort ?? 'low');
    }, [thread]);

    useEffect(() => {
        if (!hasInitialized.current && storedMessages.length > 0) {
            hasInitialized.current = true;
            setMessages(
                storedMessages.map((m) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    reasoning: m.reasoning,
                }))
            );
        }
    }, [storedMessages]);


    useEffect(() => {
        hasInitialized.current = false;
        lastRequestFailed.current = false; // Reset on new chat
        setMessages([]);
        setInputValue('');
        setIsLoading(false);
        setIsThinking(false);
        generatingRef.current = null;
        // Reset reasoning effort only if it's not already 'low' or if we want to default to 'low' for new chats
        setReasoningEffort('low');
        setIsAtBottom(true);
    }, [chatId]);

    const scrollToBottom = useCallback(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            setIsAtBottom(true);
        }
    }, []);

    const handleScroll = useCallback(() => {
        if (scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            const atBottom = scrollHeight - scrollTop - clientHeight < 50;
            setIsAtBottom(atBottom);
        }
    }, []);

    useEffect(() => {
        if (scrollRef.current && isAtBottom) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isThinking, isAtBottom]);

    const handleModelChange = async (newModel: string) => {
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
            setIsLoading(false);
            setIsThinking(false);
            generatingRef.current = null;
        }
    }, []);

    const generateResponse = useCallback(async (currentMessages: ChatMessageType[]) => {
        const lastMsg = currentMessages[currentMessages.length - 1];
        if (generatingRef.current === lastMsg.id) return;
        generatingRef.current = lastMsg.id;

        // Check if model supports reasoning
        const selectedModel = AVAILABLE_MODELS.find(m => m.id === model);
        const supportsReasoning = selectedModel?.supportsReasoning ?? true;

        // For models that use thinking param (like Kimi), disable thinking UI when reasoning is low
        const willThink = supportsReasoning && !(selectedModel?.usesThinkingParam && reasoningEffort === 'low');

        // Create assistant message immediately so loading indicator shows
        const assistantMsgId = crypto.randomUUID();
        const assistantMsg: ChatMessageType = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            reasoning: '',
        };
        setMessages(prev => [...prev, assistantMsg]);

        // Only set isThinking for models that will actually think
        setIsThinking(willThink);
        setIsLoading(true);
        abortControllerRef.current = new AbortController();

        // Update title if it's a new chat and we have at least one message
        // Use async check to handle cases where thread hook hasn't loaded yet
        const updateTitleIfNeeded = async () => {
            const currentThread = thread ?? await import('@/lib/db').then(m => m.db.threads.get(chatId));
            if (currentThread?.title === 'New Chat' && currentMessages.length > 0) {
                const firstUserMsg = currentMessages.find(m => m.role === 'user');
                if (firstUserMsg) {
                    const title = firstUserMsg.content.slice(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
                    updateThreadTitle(chatId, title);
                }
            }
        };
        updateTitleIfNeeded();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: currentMessages.map((m) => ({ role: m.role, content: m.content })),
                    model,
                    reasoningEffort,
                }),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                throw new Error('Failed to get response');
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';
            let fullReasoning = '';

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

            await addMessage(chatId, 'assistant', fullContent, fullReasoning);
            await touchThread(chatId);
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                // User stopped
            } else {
                console.error('Chat error:', error);
                showToast('Failed to generate response. Please try again.', 'error');
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
        // Don't auto-retry if the last request failed
        if (lastRequestFailed.current) {
            return;
        }
        if (hasInitialized.current && messages.length > 0 && !isLoading && !isThinking) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'user') {
                generateResponse(messages);
            }
        }
    }, [messages, isLoading, isThinking, generateResponse]);

    const sendMessage = useCallback(async (userMessage: string, existingMessages: ChatMessageType[]) => {
        // Reset the failure flag when user manually sends a message
        lastRequestFailed.current = false;

        const userMsg: ChatMessageType = {
            id: crypto.randomUUID(),
            role: 'user',
            content: userMessage,
        };

        const updatedMessages = [...existingMessages, userMsg];
        setMessages(updatedMessages);
        await addMessage(chatId, 'user', userMessage);

        await generateResponse(updatedMessages);
    }, [chatId, generateResponse]);

    const handleSend = useCallback(async () => {
        if (!inputValue.trim() || isLoading) return;
        const userMessage = inputValue.trim();
        setInputValue('');
        setIsAtBottom(true);
        await sendMessage(userMessage, messages);
    }, [inputValue, isLoading, messages, sendMessage]);

    const handlePromptClick = (prompt: string) => {
        setInputValue(prompt);
    };

    const handleEdit = useCallback(async (messageId: string, newContent: string) => {
        const msgIndex = messages.findIndex(m => m.id === messageId);
        if (msgIndex === -1) return;

        const previousMessages = messages.slice(0, msgIndex);
        const messagesToDelete = storedMessages.slice(msgIndex);
        for (const msg of messagesToDelete) {
            await deleteMessage(msg.id);
        }

        const userMsg: ChatMessageType = {
            id: crypto.randomUUID(),
            role: 'user',
            content: newContent
        };
        const updatedMessages = [...previousMessages, userMsg];

        setMessages(updatedMessages);
        await addMessage(chatId, 'user', newContent);

        await generateResponse(updatedMessages);
    }, [messages, storedMessages, chatId, generateResponse]);

    const handleRetry = useCallback(async (messageId: string) => {
        let msgIndex = messages.findIndex(m => m.id === messageId);
        if (msgIndex === -1) return;

        // If retrying an assistant message, find the preceding user message
        if (messages[msgIndex].role === 'assistant') {
            msgIndex = messages.slice(0, msgIndex).findLastIndex(m => m.role === 'user');
            if (msgIndex === -1) return;
        } else if (messages[msgIndex].role !== 'user') {
            return;
        }

        const previousMessages = messages.slice(0, msgIndex + 1); // Include the user message
        const messagesToDelete = storedMessages.slice(msgIndex + 1); // Delete responses after it

        for (const msg of messagesToDelete) {
            await deleteMessage(msg.id);
        }

        setMessages(previousMessages);
        await generateResponse(previousMessages);
    }, [messages, storedMessages, generateResponse]);

    return (
        <ChatLayout>
            <div className="flex flex-col h-full bg-[#1a1520]">
                {/* Settings button in top right */}
                <div className="absolute top-6 right-8 z-10">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-zinc-500 hover:text-zinc-300 hover:bg-[#2a2035]/50 rounded-xl transition-all"
                    >
                        <Settings className="h-5 w-5" />
                    </Button>
                </div>

                <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto scroll-smooth"
                    onScroll={handleScroll}
                >
                    {messages.length === 0 && !isThinking ? (
                        <div className="flex flex-col items-center justify-center h-full px-4">
                            {/* Main heading */}
                            <h1 className="text-3xl font-bold text-zinc-100 mb-6">
                                How can I help you?
                            </h1>

                            {/* Category buttons */}
                            <div className="flex gap-2 mb-8">
                                {CATEGORIES.map((cat) => {
                                    const IconComponent = ICON_MAP[cat.icon];
                                    return (
                                        <Button
                                            key={cat.label}
                                            variant="ghost"
                                            className="h-9 px-4 gap-2 text-zinc-400 bg-transparent hover:bg-[#2a2035] border border-[#3a3045] rounded-full text-sm"
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
                                        className="w-full text-left px-1 py-2 text-sm text-pink-300/80 hover:text-pink-200 transition-colors"
                                    >
                                        {prompt}
                                    </button>
                                ))}
                            </div>

                            {/* Terms and Privacy Policy (at bottom) */}
                            <div className="absolute bottom-24 left-0 right-0 text-center">
                                <p className="text-xs text-zinc-500">
                                    Make sure you agree to our{' '}
                                    <span className="underline cursor-pointer hover:text-zinc-400">Terms</span>
                                    {' '}and our{' '}
                                    <span className="underline cursor-pointer hover:text-zinc-400">Privacy Policy</span>
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="max-w-3xl mx-auto pt-8 pb-4">
                            {messages.map((message, i) => {
                                const selectedModel = AVAILABLE_MODELS.find((m) => m.id === model);
                                return (
                                    <ChatMessage
                                        key={message.id}
                                        id={message.id}
                                        role={message.role}
                                        content={message.content.replace(HEADING_FIX_REGEX, '$1 $2')}
                                        reasoning={message.reasoning}
                                        isStreaming={isLoading && i === messages.length - 1 && message.role === 'assistant'}
                                        isThinking={isThinking && i === messages.length - 1 && message.role === 'assistant'}
                                        modelName={message.role === 'assistant' ? selectedModel?.name : undefined}
                                        onEdit={message.role === 'user' ? handleEdit : undefined}
                                        onRetry={handleRetry}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="relative w-full max-w-3xl mx-auto px-4">
                    {/* Floating Scroll to Bottom Button - Pill Style */}
                    {!isAtBottom && scrollRef.current && scrollRef.current.scrollHeight > scrollRef.current.clientHeight && (
                        <div className="absolute -top-14 left-1/2 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <button
                                onClick={scrollToBottom}
                                className="h-9 px-4 rounded-full bg-zinc-900/60 backdrop-blur-lg border border-white/5 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/80 shadow-2xl transition-all flex items-center gap-2 group"
                            >
                                <span className="text-xs font-semibold tracking-tight">Scroll to bottom</span>
                                <ChevronDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                            </button>
                        </div>
                    )}
                </div>

                <ChatInput
                    value={inputValue}
                    onChange={setInputValue}
                    onSubmit={handleSend}
                    onStop={handleStop}
                    isLoading={isLoading}
                    currentModel={model}
                    onModelChange={handleModelChange}
                    reasoningEffort={reasoningEffort}
                    onReasoningEffortChange={handleReasoningEffortChange}
                />
            </div>
        </ChatLayout>
    );
}
