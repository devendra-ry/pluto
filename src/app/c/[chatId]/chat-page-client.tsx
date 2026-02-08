'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ChatMessage } from '@/components/chat-message';
import { ChatInput, type ReasoningEffort } from '@/components/chat-input';
import { ChatLayout } from '@/components/chat-layout';
import { useThread, updateThreadTitle, updateThreadModel, touchThread } from '@/hooks/use-threads';
import { useMessages, addMessage, deleteMessage } from '@/hooks/use-messages';
import { DEFAULT_MODEL, AVAILABLE_MODELS } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Wand2, BookOpen, Code, GraduationCap, Brain, Settings, ChevronUp } from 'lucide-react';

interface ChatPageClientProps {
    chatId: string;
}

interface ChatMessageType {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
}

const SUGGESTED_PROMPTS = [
    "How does AI work?",
    "Are black holes real?",
    "How many Rs are in the word \"strawberry\"?",
    "What is the meaning of life?",
];

const CATEGORIES = [
    { icon: Wand2, label: 'Create' },
    { icon: BookOpen, label: 'Explore' },
    { icon: Code, label: 'Code' },
    { icon: GraduationCap, label: 'Learn' },
];

export function ChatPageClient({ chatId }: ChatPageClientProps) {
    const thread = useThread(chatId);
    const storedMessages = useMessages(chatId);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [model, setModel] = useState<string>(DEFAULT_MODEL);
    const [inputValue, setInputValue] = useState('');
    const [messages, setMessages] = useState<ChatMessageType[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [currentReasoning, setCurrentReasoning] = useState('');
    const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('low');
    const hasInitialized = useRef(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (thread?.model) {
            setModel(thread.model);
        }
    }, [thread?.model]);

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
        setMessages([]);
        setInputValue('');
        setIsLoading(false);
        setIsThinking(false);
        setCurrentReasoning('');
    }, [chatId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isThinking, currentReasoning]);

    const handleModelChange = async (newModel: string) => {
        setModel(newModel);
        await updateThreadModel(chatId, newModel);
    };

    const handleStop = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsLoading(false);
            setIsThinking(false);
            setCurrentReasoning('');
        }
    }, []);

    const sendMessage = useCallback(async (userMessage: string, existingMessages: ChatMessageType[]) => {
        const userMsg: ChatMessageType = {
            id: crypto.randomUUID(),
            role: 'user',
            content: userMessage,
        };

        const updatedMessages = [...existingMessages, userMsg];
        setMessages(updatedMessages);
        await addMessage(chatId, 'user', userMessage);

        if (thread?.title === 'New Chat' && existingMessages.length === 0) {
            const title = userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '');
            await updateThreadTitle(chatId, title);
        }

        setIsThinking(true);
        setIsLoading(true);
        setCurrentReasoning('');
        abortControllerRef.current = new AbortController();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
                    model,
                    reasoningEffort,
                }),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                throw new Error('Failed to get response');
            }

            const assistantMsg: ChatMessageType = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: '',
                reasoning: '',
            };
            setMessages([...updatedMessages, assistantMsg]);

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
                                if (reasoningContent) {
                                    fullReasoning += reasoningContent;
                                    setCurrentReasoning(fullReasoning);
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
                                        const lastIdx = updated.length - 1;
                                        if (updated[lastIdx]?.role === 'assistant') {
                                            updated[lastIdx] = {
                                                ...updated[lastIdx],
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
                setMessages(updatedMessages);
            }
        } finally {
            setIsLoading(false);
            setIsThinking(false);
            setCurrentReasoning('');
            abortControllerRef.current = null;
        }
    }, [chatId, model, reasoningEffort, thread?.title]);

    const handleSend = useCallback(async () => {
        if (!inputValue.trim() || isLoading) return;
        const userMessage = inputValue.trim();
        setInputValue('');
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

        setMessages(previousMessages);
        await sendMessage(newContent, previousMessages);
    }, [messages, storedMessages, sendMessage]);

    const handleRetry = useCallback(async (messageId: string) => {
        const msgIndex = messages.findIndex(m => m.id === messageId);
        if (msgIndex === -1 || messages[msgIndex].role !== 'user') return;

        const userContent = messages[msgIndex].content;
        const previousMessages = messages.slice(0, msgIndex);
        const messagesToDelete = storedMessages.slice(msgIndex);
        for (const msg of messagesToDelete) {
            await deleteMessage(msg.id);
        }

        setMessages(previousMessages);
        await sendMessage(userContent, previousMessages);
    }, [messages, storedMessages, sendMessage]);

    const handleDelete = useCallback(async (messageId: string) => {
        await deleteMessage(messageId);
        setMessages(prev => prev.filter(m => m.id !== messageId));
    }, []);

    return (
        <ChatLayout>
            <div className="flex flex-col h-full bg-[#1a1520]">
                {/* Settings button in top right */}
                <div className="absolute top-4 right-4 z-10">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-zinc-500 hover:text-zinc-300 hover:bg-[#2a2035]"
                    >
                        <Settings className="h-4 w-4" />
                    </Button>
                </div>

                <div ref={scrollRef} className="flex-1 overflow-y-auto">
                    {messages.length === 0 && !isThinking ? (
                        <div className="flex flex-col items-center justify-center h-full px-4">
                            {/* Main heading */}
                            <h1 className="text-3xl font-bold text-zinc-100 mb-6">
                                How can I help you?
                            </h1>

                            {/* Category buttons */}
                            <div className="flex gap-2 mb-8">
                                {CATEGORIES.map((cat) => (
                                    <Button
                                        key={cat.label}
                                        variant="ghost"
                                        className="h-9 px-4 gap-2 text-zinc-400 bg-transparent hover:bg-[#2a2035] border border-[#3a3045] rounded-full text-sm"
                                    >
                                        <cat.icon className="h-4 w-4" />
                                        {cat.label}
                                    </Button>
                                ))}
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
                        <div className="max-w-3xl mx-auto py-4">
                            {messages.map((message, i) => {
                                const selectedModel = AVAILABLE_MODELS.find((m) => m.id === model);
                                return (
                                    <ChatMessage
                                        key={message.id}
                                        id={message.id}
                                        role={message.role}
                                        content={message.content}
                                        reasoning={message.reasoning}
                                        isStreaming={isLoading && i === messages.length - 1 && message.role === 'assistant'}
                                        modelName={message.role === 'assistant' ? selectedModel?.name : undefined}
                                        onEdit={message.role === 'user' ? handleEdit : undefined}
                                        onRetry={handleRetry}
                                        onDelete={handleDelete}
                                    />
                                );
                            })}

                            {/* Thinking indicator with live reasoning */}
                            {isThinking && (
                                <div className="py-4 px-4">
                                    <div className="flex items-center gap-2 text-zinc-400 mb-3">
                                        <Brain className="h-4 w-4" />
                                        <span className="text-sm font-medium">Reasoning</span>
                                        <ChevronUp className="h-4 w-4" />
                                    </div>
                                    {currentReasoning && (
                                        <div className="rounded-xl bg-[#1f0f1f] p-5 text-sm text-zinc-300 leading-relaxed">
                                            <p className="whitespace-pre-wrap">{currentReasoning}</p>
                                        </div>
                                    )}
                                </div>
                            )}
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
                    onReasoningEffortChange={setReasoningEffort}
                />
            </div>
        </ChatLayout>
    );
}
