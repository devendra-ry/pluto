'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SerialValueWriter } from '@/shared/lib/serial-value-writer';

import {
    updateReasoningEffort,
    updateThreadModel,
    updateThreadSystemPrompt,
    type Thread,
} from '@/features/threads';
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
    return !modelConfig.hidden;
}

export function useThreadSettings({ chatId, thread, showToast }: UseThreadSettingsParams) {
    const [model, setModel] = useState<string>(DEFAULT_MODEL);
    const modelRef = useRef<string>(DEFAULT_MODEL);
    const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
    const reasoningEffortRef = useRef<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
    const [systemPrompt, setSystemPrompt] = useState('');
    const systemPromptRef = useRef('');
    const writers = useMemo(() => ({
        model: new SerialValueWriter<string>(DEFAULT_MODEL),
        reasoning: new SerialValueWriter<ReasoningEffort>(DEFAULT_REASONING_EFFORT),
        prompt: new SerialValueWriter(''),
        scope: chatId,
    }), [chatId]);
    const activeWritersRef = useRef<typeof writers | null>(writers);

    useLayoutEffect(() => {
        activeWritersRef.current = writers;
        return () => { activeWritersRef.current = null; };
    }, [writers]);

    useEffect(() => {
        modelRef.current = model;
    }, [model]);

    useEffect(() => {
        reasoningEffortRef.current = reasoningEffort;
    }, [reasoningEffort]);

    useEffect(() => {
        if (thread?.model && isSelectableChatModel(thread.model) && writers.model.synchronize(thread.model)) {
            modelRef.current = thread.model;
            setModel(thread.model);
        }
        if (thread?.reasoning_effort && writers.reasoning.synchronize(thread.reasoning_effort)) {
            reasoningEffortRef.current = thread.reasoning_effort;
            setReasoningEffort(thread.reasoning_effort);
        }
        if (writers.prompt.synchronize(thread?.system_prompt ?? '')) {
            systemPromptRef.current = thread?.system_prompt ?? '';
            setSystemPrompt(systemPromptRef.current);
        }
    }, [thread, writers]);

    const applyPendingReasoningEffort = useCallback((nextEffort: ReasoningEffort) => {
        reasoningEffortRef.current = nextEffort;
        setReasoningEffort(nextEffort);
    }, []);

    const resetThreadScopedState = useCallback(() => {
        modelRef.current = DEFAULT_MODEL;
        setModel(DEFAULT_MODEL);
        reasoningEffortRef.current = DEFAULT_REASONING_EFFORT;
        setReasoningEffort(DEFAULT_REASONING_EFFORT);
        setSystemPrompt('');
        systemPromptRef.current = '';
    }, []);

    const handleModelChange = useCallback(async (newModel: string) => {
        if (!isSelectableChatModel(newModel)) {
            return;
        }

        modelRef.current = newModel;
        setModel(newModel);
        const result = await writers.model.write(newModel, value => updateThreadModel(chatId, value));
        if (!result.ok && activeWritersRef.current === writers && writers.model.isLatest(result.revision)) {
            modelRef.current = result.value;
            setModel(result.value);
            const message = result.error instanceof Error ? result.error.message : 'Failed to update model';
            showToast(message, 'error');
        }
    }, [chatId, showToast, writers]);

    const handleReasoningEffortChange = useCallback(async (effort: ReasoningEffort) => {
        reasoningEffortRef.current = effort;
        setReasoningEffort(effort);
        const result = await writers.reasoning.write(effort, value => updateReasoningEffort(chatId, value));
        if (!result.ok && activeWritersRef.current === writers && writers.reasoning.isLatest(result.revision)) {
            reasoningEffortRef.current = result.value;
            setReasoningEffort(result.value);
            const message = result.error instanceof Error ? result.error.message : 'Failed to update reasoning effort';
            showToast(message, 'error');
        }
    }, [chatId, showToast, writers]);

    const handleSystemPromptChange = useCallback(async (nextPrompt: string) => {
        systemPromptRef.current = nextPrompt;
        setSystemPrompt(nextPrompt);
        const result = await writers.prompt.write(nextPrompt, value => updateThreadSystemPrompt(chatId, value));
        if (!result.ok && activeWritersRef.current === writers && writers.prompt.isLatest(result.revision)) {
            systemPromptRef.current = result.value;
            setSystemPrompt(result.value);
            // The prompt editor owns its error UI and must stay open on failure.
            throw result.error;
        }
    }, [chatId, writers]);

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
