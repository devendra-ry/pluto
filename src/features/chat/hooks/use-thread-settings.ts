'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
    updateReasoningEffort,
    updateThreadModel,
    updateThreadSystemPrompt,
    type Thread,
} from '@/features/threads/hooks/use-threads';
import { AVAILABLE_MODELS, DEFAULT_MODEL, DEFAULT_REASONING_EFFORT } from '@/shared/core/constants';
import { type ReasoningEffort } from '@/shared/core/types';

type ToastType = 'success' | 'error' | 'info';

interface UseThreadSettingsParams {
    chatId: string;
    thread: Thread | undefined;
    showToast: (message: string, type?: ToastType) => void;
}

function isSelectableChatModel(modelId: string): boolean {
    const modelConfig = AVAILABLE_MODELS.find((m) => m.id === modelId);
    if (!modelConfig) return false;
    return !modelConfig.hidden && !modelConfig.capabilities.includes('imageGen');
}

export function useThreadSettings({ chatId, thread, showToast }: UseThreadSettingsParams) {
    const [model, setModel] = useState<string>(DEFAULT_MODEL);
    const modelRef = useRef<string>(DEFAULT_MODEL);
    const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
    const reasoningEffortRef = useRef<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
    const [systemPrompt, setSystemPrompt] = useState('');

    useEffect(() => {
        modelRef.current = model;
    }, [model]);

    useEffect(() => {
        reasoningEffortRef.current = reasoningEffort;
    }, [reasoningEffort]);

    useEffect(() => {
        if (thread?.model && isSelectableChatModel(thread.model)) {
            modelRef.current = thread.model;
            setModel(thread.model);
        }
        if (thread?.reasoning_effort) {
            reasoningEffortRef.current = thread.reasoning_effort;
            setReasoningEffort(thread.reasoning_effort);
        }
        setSystemPrompt(thread?.system_prompt ?? '');
    }, [thread]);

    const applyPendingReasoningEffort = useCallback((nextEffort: ReasoningEffort) => {
        reasoningEffortRef.current = nextEffort;
        setReasoningEffort(nextEffort);
    }, []);

    const resetThreadScopedState = useCallback(() => {
        reasoningEffortRef.current = DEFAULT_REASONING_EFFORT;
        setReasoningEffort(DEFAULT_REASONING_EFFORT);
        setSystemPrompt('');
    }, []);

    const handleModelChange = useCallback(async (newModel: string) => {
        if (!isSelectableChatModel(newModel)) {
            return;
        }

        const previousModel = modelRef.current;
        modelRef.current = newModel;
        setModel(newModel);
        try {
            await updateThreadModel(chatId, newModel);
        } catch (error) {
            modelRef.current = previousModel;
            setModel(previousModel);
            const message = error instanceof Error ? error.message : 'Failed to update model';
            showToast(message, 'error');
        }
    }, [chatId, showToast]);

    const handleReasoningEffortChange = useCallback(async (effort: ReasoningEffort) => {
        const previousEffort = reasoningEffortRef.current;
        reasoningEffortRef.current = effort;
        setReasoningEffort(effort);
        try {
            await updateReasoningEffort(chatId, effort);
        } catch (error) {
            reasoningEffortRef.current = previousEffort;
            setReasoningEffort(previousEffort);
            const message = error instanceof Error ? error.message : 'Failed to update reasoning effort';
            showToast(message, 'error');
        }
    }, [chatId, showToast]);

    const handleSystemPromptChange = useCallback(async (nextPrompt: string) => {
        const previousPrompt = systemPrompt;
        setSystemPrompt(nextPrompt);
        try {
            await updateThreadSystemPrompt(chatId, nextPrompt);
        } catch (error) {
            setSystemPrompt(previousPrompt);
            const message = error instanceof Error ? error.message : 'Failed to update system prompt';
            showToast(message, 'error');
        }
    }, [chatId, showToast, systemPrompt]);

    return {
        model,
        modelRef,
        reasoningEffort,
        reasoningEffortRef,
        systemPrompt,
        applyPendingReasoningEffort,
        resetThreadScopedState,
        handleModelChange,
        handleReasoningEffortChange,
        handleSystemPromptChange,
    };
}