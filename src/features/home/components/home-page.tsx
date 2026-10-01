'use client';

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createThread, updateReasoningEffort, updateThreadModel, updateThreadSystemPrompt, cleanupEmptyThreads, triggerThreadRefresh } from '@/features/threads';
import { startChatWithMessage, type StartChatWithMessageInput } from '@/features/chat';
import { DEFAULT_MODEL, SUGGESTED_PROMPTS, CATEGORIES, DEFAULT_REASONING_EFFORT, type CategoryIconName } from '@/shared/core/constants';
import { ChatInput, type ChatInputHandle } from '@/features/chat';
import { type Attachment, type ReasoningEffort } from '@/shared/core/types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Wand2, BookOpen, Code, GraduationCap, Loader2, type LucideIcon } from 'lucide-react';
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

// Map icon names to components
const ICON_MAP = {
  Wand2,
  BookOpen,
  Code,
  GraduationCap,
} satisfies Record<CategoryIconName, LucideIcon>;

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
  const [writers] = useState(() => ({
    model: new SerialValueWriter<string>(DEFAULT_MODEL),
    reasoning: new SerialValueWriter<ReasoningEffort>(DEFAULT_REASONING_EFFORT),
    prompt: new SerialValueWriter(''),
  }));
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<Pick<StartChatWithMessageInput, 'content' | 'attachments'> | null>(null);
  const submissionInFlightRef = useRef(false);
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

  const ensureThread = useCallback(async () => {
    if (ensureThreadPromiseRef.current) {
      return ensureThreadPromiseRef.current;
    }

    if (draftThreadIdRef.current) {
      return draftThreadIdRef.current;
    }

    const createPromise = (async () => {
      const savedModel = modelRef.current;
      const savedEffort = reasoningEffortRef.current;
      const savedPrompt = systemPromptRef.current;
      const thread = await createThread(savedModel, savedEffort, savedPrompt);

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
            if (!mountedRef.current) return;
            modelRef.current = value;
            setModel(value);
          },
          error => {
            if (mountedRef.current) showToast(error instanceof Error ? error.message : 'Failed to update model', 'error');
          },
        ),
        persistCreatedValue(
          writers.reasoning,
          savedEffort,
          reasoningEffortRef.current,
          value => updateReasoningEffort(thread.id, value),
          value => {
            if (!mountedRef.current) return;
            reasoningEffortRef.current = value;
            setReasoningEffort(value);
          },
          error => {
            if (mountedRef.current) showToast(error instanceof Error ? error.message : 'Failed to update reasoning effort', 'error');
          },
        ),
        persistCreatedValue(
          writers.prompt,
          savedPrompt,
          systemPromptRef.current,
          value => updateThreadSystemPrompt(thread.id, value),
          value => {
            if (!mountedRef.current) return;
            systemPromptRef.current = value;
            setSystemPrompt(value);
          },
          error => {
            if (mountedRef.current) showToast(error instanceof Error ? error.message : 'Failed to update system prompt', 'error');
          },
        ),
      ]);

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
    systemPromptRef.current = nextPrompt;
    setSystemPrompt(nextPrompt);
    const targetThreadId = draftThreadIdRef.current;
    if (!targetThreadId) { writers.prompt.synchronize(nextPrompt); return; }
    const result = await writers.prompt.write(nextPrompt, value => updateThreadSystemPrompt(targetThreadId, value));
    if (!result.ok && mountedRef.current && writers.prompt.isLatest(result.revision)) {
      systemPromptRef.current = result.value;
      setSystemPrompt(result.value);
      throw result.error;
    }
  };

  const handleModelChange = async (nextModel: string) => {
    modelRef.current = nextModel;
    setModel(nextModel);
    const targetThreadId = draftThreadIdRef.current;
    if (!targetThreadId) { writers.model.synchronize(nextModel); return; }
    const result = await writers.model.write(nextModel, value => updateThreadModel(targetThreadId, value));
    if (!result.ok && mountedRef.current && writers.model.isLatest(result.revision)) {
      modelRef.current = result.value;
      setModel(result.value);
      showToast(result.error instanceof Error ? result.error.message : 'Failed to update model', 'error');
    }
  };

  const handleReasoningEffortChange = async (nextEffort: ReasoningEffort) => {
    reasoningEffortRef.current = nextEffort;
    setReasoningEffort(nextEffort);
    const targetThreadId = draftThreadIdRef.current;
    if (!targetThreadId) { writers.reasoning.synchronize(nextEffort); return; }
    const result = await writers.reasoning.write(nextEffort, value => updateReasoningEffort(targetThreadId, value));
    if (!result.ok && mountedRef.current && writers.reasoning.isLatest(result.revision)) {
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
      <div className={`flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-4 ${pendingSubmission ? 'justify-start' : 'justify-center'}`}>
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
        <div className="w-full max-w-3xl flex flex-col items-start px-4">
          {/* Main heading */}
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-8 tracking-tight text-center md:text-left">
            How can I help you?
          </h1>

          {/* Category buttons */}
          <div className="mb-10 grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-start">

            {CATEGORIES.map((cat) => {
              const IconComponent = ICON_MAP[cat.icon];
              return (
                <Button
                  key={cat.label}
                  variant="ghost"
                  onClick={() => handleSuggestionClick(cat.prompt)}
                  className="h-11 justify-center gap-2 rounded-full border border-border bg-card px-3 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
                >
                  <IconComponent className="h-4 w-4" />
                  {cat.label}
                </Button>
              );
            })}
          </div>

          {/* Suggested prompts */}
          <div className="space-y-1 w-full text-left">
            {SUGGESTED_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                onClick={() => handleSuggestionClick(prompt)}
                className="w-full rounded-md px-2 py-3 text-left text-base text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
        )}

      </div>

      <ChatInput
        ref={chatInputRef}
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
      {!pendingSubmission && (
        <p className="px-4 pb-3 text-center text-xs text-muted-foreground">
          Make sure you agree to our <span className="underline">Terms</span> and our{' '}
          <span className="underline">Privacy Policy</span>
        </p>
      )}
    </div>
  );
}
