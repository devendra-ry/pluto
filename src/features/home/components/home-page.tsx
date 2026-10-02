'use client';

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createThread, deleteThread, cleanupEmptyThreads, updateReasoningEffort, updateThreadModel, updateThreadSystemPrompt, triggerThreadRefresh, NEW_CHAT_EVENT } from '@/features/threads';
import { ChatEmptyState, ChatInput, startChatWithMessage, type ChatInputHandle, type StartChatWithMessageInput } from '@/features/chat';
import { DEFAULT_MODEL, DEFAULT_REASONING_EFFORT } from '@/shared/core/constants';
import { type Attachment, type ReasoningEffort } from '@/shared/core/types';
import { useToast } from '@/components/ui/toast';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { SerialValueWriter } from '@/shared/lib/serial-value-writer';

function toErrorRecord(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { message: error.message };
  const result = z.record(z.string(), z.unknown()).safeParse(error);
  return result.success ? result.data : {};
}

async function persistCreatedValue<T>(
  writer: SerialValueWriter<T>,
  createdValue: T,
  requestedValue: T,
  persist: (value: T) => Promise<void>,
  restoreLatestValue: (value: T) => void,
  reportFailure: (error: unknown) => void,
) {
  if (Object.is(requestedValue, createdValue)) return;

  const result = await writer.write(requestedValue, persist);
  if (!result.ok && writer.isLatest(result.revision)) {
    restoreLatestValue(result.value);
    reportFailure(result.error);
  }
}

function createHomeWriters() {
  return {
    model: new SerialValueWriter<string>(DEFAULT_MODEL),
    reasoning: new SerialValueWriter<ReasoningEffort>(DEFAULT_REASONING_EFFORT),
    prompt: new SerialValueWriter(''),
  };
}

export default function HomePage() {
  const router = useRouter();
  const chatInputRef = useRef<ChatInputHandle>(null);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const modelRef = useRef(DEFAULT_MODEL);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
  const reasoningEffortRef = useRef<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
  const [systemPrompt, setSystemPrompt] = useState('');
  const systemPromptRef = useRef('');
  const mountedRef = useRef(true);
  const [writers, setWriters] = useState(createHomeWriters);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<Pick<StartChatWithMessageInput, 'content' | 'attachments'> | null>(null);
  const [composerEpoch, setComposerEpoch] = useState(0);
  const submissionInFlightRef = useRef(false);
  const draftEpochRef = useRef(0);
  const [draftThreadId, setDraftThreadId] = useState<string | null>(null);
  const draftThreadIdRef = useRef<string | null>(null);
  const ensureThreadPromiseRef = useRef<Promise<string> | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  useEffect(() => {
    reasoningEffortRef.current = reasoningEffort;
  }, [reasoningEffort]);

  useEffect(() => {
    const resetDraft = () => {
      if (submissionInFlightRef.current) return;
      const pendingThread = ensureThreadPromiseRef.current;
      const currentDraftId = draftThreadIdRef.current;
      draftEpochRef.current += 1;
      setWriters(createHomeWriters());
      ensureThreadPromiseRef.current = null;
      draftThreadIdRef.current = null;
      setDraftThreadId(null);
      setPendingSubmission(null);
      setIsLoading(false);
      setComposerEpoch((epoch) => epoch + 1);
      void (currentDraftId
        ? deleteThread(currentDraftId, { cleanupOtherEmptyThreads: false })
        : pendingThread ? pendingThread.catch(() => undefined) : Promise.resolve())
        .catch((error) => console.warn('[threads] Failed to clear the previous empty draft:', error));
    };
    window.addEventListener(NEW_CHAT_EVENT, resetDraft);
    return () => window.removeEventListener(NEW_CHAT_EVENT, resetDraft);
  }, []);

  const ensureThread = useCallback(async () => {
    if (ensureThreadPromiseRef.current) {
      return ensureThreadPromiseRef.current;
    }

    if (draftThreadIdRef.current) {
      return draftThreadIdRef.current;
    }

    const createPromise = (async () => {
      const epochAtStart = draftEpochRef.current;
      const savedModel = modelRef.current;
      const savedEffort = reasoningEffortRef.current;
      const savedPrompt = systemPromptRef.current;
      const thread = await createThread(savedModel, savedEffort, savedPrompt, { cleanupOtherEmptyThreads: false });

      if (draftEpochRef.current !== epochAtStart) {
        await deleteThread(thread.id, { cleanupOtherEmptyThreads: false });
        throw new DOMException('The draft was reset before it finished initializing.', 'AbortError');
      }

      // Creation stored the values captured above. Establish those as the
      // confirmed writer baselines before later UI changes can enqueue writes.
      writers.model.synchronize(savedModel);
      writers.reasoning.synchronize(savedEffort);
      writers.prompt.synchronize(savedPrompt);
      // Keep ensureThread callers coalesced until reconciliation settles. The
      // ref lets setting handlers queue later choices behind the initial writes.
      draftThreadIdRef.current = thread.id;

      await Promise.all([
        persistCreatedValue(
          writers.model,
          savedModel,
          modelRef.current,
          value => updateThreadModel(thread.id, value),
          value => {
            if (!mountedRef.current || draftEpochRef.current !== epochAtStart) return;
            modelRef.current = value;
            setModel(value);
          },
          error => {
            if (mountedRef.current && draftEpochRef.current === epochAtStart) showToast(error instanceof Error ? error.message : 'Failed to update model', 'error');
          },
        ),
        persistCreatedValue(
          writers.reasoning,
          savedEffort,
          reasoningEffortRef.current,
          value => updateReasoningEffort(thread.id, value),
          value => {
            if (!mountedRef.current || draftEpochRef.current !== epochAtStart) return;
            reasoningEffortRef.current = value;
            setReasoningEffort(value);
          },
          error => {
            if (mountedRef.current && draftEpochRef.current === epochAtStart) showToast(error instanceof Error ? error.message : 'Failed to update reasoning effort', 'error');
          },
        ),
        persistCreatedValue(
          writers.prompt,
          savedPrompt,
          systemPromptRef.current,
          value => updateThreadSystemPrompt(thread.id, value),
          value => {
            if (!mountedRef.current || draftEpochRef.current !== epochAtStart) return;
            systemPromptRef.current = value;
            setSystemPrompt(value);
          },
          error => {
            if (mountedRef.current && draftEpochRef.current === epochAtStart) showToast(error instanceof Error ? error.message : 'Failed to update system prompt', 'error');
          },
        ),
      ]);

      if (draftEpochRef.current !== epochAtStart) {
        throw new DOMException('The draft was reset before it finished initializing.', 'AbortError');
      }

      if (mountedRef.current) setDraftThreadId(thread.id);
      return thread.id;
    })();

    ensureThreadPromiseRef.current = createPromise;
    try {
      return await createPromise;
    } finally {
      if (ensureThreadPromiseRef.current === createPromise) {
        ensureThreadPromiseRef.current = null;
      }
    }
  }, [showToast, writers]);

  const handleSystemPromptChange = async (nextPrompt: string) => {
    const epochAtStart = draftEpochRef.current;
    systemPromptRef.current = nextPrompt;
    setSystemPrompt(nextPrompt);
    const targetThreadId = draftThreadIdRef.current;
    if (!targetThreadId) { writers.prompt.synchronize(nextPrompt); return; }
    const result = await writers.prompt.write(nextPrompt, value => updateThreadSystemPrompt(targetThreadId, value));
    if (!result.ok && mountedRef.current && draftEpochRef.current === epochAtStart && writers.prompt.isLatest(result.revision)) {
      systemPromptRef.current = result.value;
      setSystemPrompt(result.value);
      throw result.error;
    }
  };

  const handleModelChange = async (nextModel: string) => {
    const epochAtStart = draftEpochRef.current;
    modelRef.current = nextModel;
    setModel(nextModel);
    const targetThreadId = draftThreadIdRef.current;
    if (!targetThreadId) { writers.model.synchronize(nextModel); return; }
    const result = await writers.model.write(nextModel, value => updateThreadModel(targetThreadId, value));
    if (!result.ok && mountedRef.current && draftEpochRef.current === epochAtStart && writers.model.isLatest(result.revision)) {
      modelRef.current = result.value;
      setModel(result.value);
      showToast(result.error instanceof Error ? result.error.message : 'Failed to update model', 'error');
    }
  };

  const handleReasoningEffortChange = async (nextEffort: ReasoningEffort) => {
    const epochAtStart = draftEpochRef.current;
    reasoningEffortRef.current = nextEffort;
    setReasoningEffort(nextEffort);
    const targetThreadId = draftThreadIdRef.current;
    if (!targetThreadId) { writers.reasoning.synchronize(nextEffort); return; }
    const result = await writers.reasoning.write(nextEffort, value => updateReasoningEffort(targetThreadId, value));
    if (!result.ok && mountedRef.current && draftEpochRef.current === epochAtStart && writers.reasoning.isLatest(result.revision)) {
      reasoningEffortRef.current = result.value;
      setReasoningEffort(result.value);
      showToast(result.error instanceof Error ? result.error.message : 'Failed to update reasoning effort', 'error');
    }
  };

  const handleSend = async (
    value: string,
    attachments: Attachment[],
  ) => {
    if ((!value.trim() && attachments.length === 0) || submissionInFlightRef.current) return false;
    const effectiveModel = modelRef.current;

    submissionInFlightRef.current = true;
    setIsLoading(true);
    setPendingSubmission({ content: value.trim(), attachments });
    try {
      const { threadId } = await startChatWithMessage({
        threadId: draftThreadIdRef.current,
        content: value.trim(),
        attachments,
        modelId: effectiveModel,
        reasoningEffort: reasoningEffortRef.current,
        systemPrompt: systemPromptRef.current.trim().length > 0
          ? systemPromptRef.current.trim()
          : null,
      });

      if (!mountedRef.current) return true;
      draftThreadIdRef.current = threadId;
      setDraftThreadId(threadId);
      triggerThreadRefresh();
      void cleanupEmptyThreads(threadId).catch((cleanupError) => {
        console.warn('[threads] Failed to cleanup empty threads after chat start:', cleanupError);
      });

      // The new route hydrates the committed message and claims its already queued job.
      router.push(`/c/${threadId}`);
      return true;
    } catch (error: unknown) {
      submissionInFlightRef.current = false;
      if (!mountedRef.current) return false;

      const errorRecord = toErrorRecord(error);

      const errorMessage = typeof errorRecord.message === 'string'
        ? errorRecord.message
        : typeof errorRecord.error_description === 'string'
          ? errorRecord.error_description
          : String(error);
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to create chat:', error);
      }
      showToast(errorMessage || 'Failed to create chat', 'error');
      setPendingSubmission(null);
      setIsLoading(false);
      return false;
    }
  };

  const handleSuggestionClick = (prompt: string) => {
    if (chatInputRef.current) {
      chatInputRef.current.setValue(prompt);
      chatInputRef.current.focus();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className={`flex min-h-0 flex-1 flex-col items-center overflow-y-auto ${pendingSubmission ? 'justify-start p-4' : 'justify-center p-0'}`}>
        {pendingSubmission ? (
          <div className="w-full max-w-3xl px-4 pt-8">
            <div className="mb-6 flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-border bg-secondary px-4 py-3 text-secondary-foreground shadow-sm">
                {pendingSubmission.content || (
                  <span className="text-muted-foreground">
                    {pendingSubmission.attachments.map((attachment) => attachment.name).join(', ')}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground" role="status" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
              <span>Starting your response…</span>
            </div>
          </div>
        ) : (
          <ChatEmptyState onPromptClick={handleSuggestionClick} />
        )}

      </div>

      <ChatInput
        key={composerEpoch}
        ref={chatInputRef}
        draftScopeId="home"
        onSubmit={handleSend}
        onEnsureThread={ensureThread}
        threadId={draftThreadId}
        isLoading={isLoading}
        currentModel={model}
        onModelChange={handleModelChange}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={handleReasoningEffortChange}
        systemPrompt={systemPrompt}
        onSystemPromptChange={handleSystemPromptChange}
      />
    </div>
  );
}
