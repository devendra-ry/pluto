'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createThread, updateReasoningEffort, updateThreadModel, updateThreadSystemPrompt } from '@/hooks/use-threads';
import { addMessage } from '@/hooks/use-messages';
import { DEFAULT_MODEL, SUGGESTED_PROMPTS, CATEGORIES, DEFAULT_REASONING_EFFORT, IMAGE_GENERATION_MODEL, isImageGenerationModel, PENDING_GENERATION_MODEL_KEY, PENDING_GENERATION_SEARCH_KEY, PENDING_GENERATION_THREAD_KEY, PENDING_REASONING_EFFORT_KEY, PENDING_SYSTEM_PROMPT_KEY, VIDEO_GENERATION_MODEL } from '@/lib/constants';
import { ChatInput, type ChatInputHandle, type ChatSubmitOptions } from '@/components/chat-input';
import { type Attachment, type ReasoningEffort } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Wand2, BookOpen, Code, GraduationCap, type LucideIcon } from 'lucide-react';

function toErrorRecord(error: unknown): Record<string, unknown> {
  return (typeof error === 'object' && error !== null) ? (error as Record<string, unknown>) : {};
}

// Map icon names to components
const ICON_MAP: Record<string, LucideIcon> = {
  Wand2,
  BookOpen,
  Code,
  GraduationCap,
};

export default function HomePage() {
  const router = useRouter();
  const chatInputRef = useRef<ChatInputHandle>(null);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const modelRef = useRef(DEFAULT_MODEL);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
  const reasoningEffortRef = useRef<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [draftThreadId, setDraftThreadId] = useState<string | null>(null);
  const draftThreadIdRef = useRef<string | null>(null);
  const ensureThreadPromiseRef = useRef<Promise<string> | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    draftThreadIdRef.current = draftThreadId;
  }, [draftThreadId]);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  useEffect(() => {
    reasoningEffortRef.current = reasoningEffort;
  }, [reasoningEffort]);

  const ensureThread = useCallback(async () => {
    if (draftThreadIdRef.current) {
      return draftThreadIdRef.current;
    }

    if (ensureThreadPromiseRef.current) {
      return ensureThreadPromiseRef.current;
    }

    const createPromise = (async () => {
      const thread = await createThread(modelRef.current, reasoningEffortRef.current, systemPrompt);
      draftThreadIdRef.current = thread.id;
      setDraftThreadId(thread.id);
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
  }, [systemPrompt]);

  const handleSystemPromptChange = async (nextPrompt: string) => {
    const previousPrompt = systemPrompt;
    setSystemPrompt(nextPrompt);
    if (draftThreadId) {
      try {
        await updateThreadSystemPrompt(draftThreadId, nextPrompt);
      } catch (error) {
        setSystemPrompt(previousPrompt);
        const message = error instanceof Error ? error.message : 'Failed to update system prompt';
        showToast(message, 'error');
      }
    }
  };

  const handleModelChange = (nextModel: string) => {
    const previousModel = modelRef.current;
    modelRef.current = nextModel;
    setModel(nextModel);
    if (!draftThreadId) return;

    void (async () => {
      try {
        await updateThreadModel(draftThreadId, nextModel);
      } catch (error) {
        setModel((current) => {
          const resolved = current === nextModel ? previousModel : current;
          modelRef.current = resolved;
          return resolved;
        });
        const message = error instanceof Error ? error.message : 'Failed to update model';
        showToast(message, 'error');
      }
    })();
  };

  const handleReasoningEffortChange = (nextEffort: ReasoningEffort) => {
    const previousEffort = reasoningEffort;
    reasoningEffortRef.current = nextEffort;
    setReasoningEffort(nextEffort);
    if (!draftThreadId) return;

    void (async () => {
      try {
        await updateReasoningEffort(draftThreadId, nextEffort);
      } catch (error) {
        reasoningEffortRef.current = previousEffort;
        setReasoningEffort((current) => current === nextEffort ? previousEffort : current);
        const message = error instanceof Error ? error.message : 'Failed to update reasoning effort';
        showToast(message, 'error');
      }
    })();
  };

  const handleSend = async (
    value: string,
    attachments: Attachment[],
    options: ChatSubmitOptions
  ) => {
    if (!value.trim() && attachments.length === 0) return false;
    const effectiveModel = modelRef.current;
    const isImageMode = options.mode === 'image' || options.mode === 'image-edit';
    const isVideoMode = options.mode === 'video';
    const isSearchMode = options.mode === 'search';
    const selectedImageModelId = options.imageModelId && isImageGenerationModel(options.imageModelId)
      ? options.imageModelId
      : IMAGE_GENERATION_MODEL;
    const targetModel = isImageMode ? selectedImageModelId : (isVideoMode ? VIDEO_GENERATION_MODEL : effectiveModel);
    const messageModel = isImageMode ? selectedImageModelId : (isVideoMode ? VIDEO_GENERATION_MODEL : effectiveModel);

    setIsLoading(true);
    try {
      // 1. Ensure thread exists (attachments may have already created one)
      const threadId = await ensureThread();

      // 2. Add the user message
      await addMessage(threadId, 'user', value.trim(), undefined, messageModel, attachments);

      // 3. Navigate to the new chat
      // The ChatPageClient will pick up the user message and start generating
      window.sessionStorage.setItem(PENDING_GENERATION_THREAD_KEY, threadId);
      window.sessionStorage.setItem(PENDING_GENERATION_MODEL_KEY, targetModel);
      if (!isImageMode && !isVideoMode) {
        window.sessionStorage.setItem(PENDING_REASONING_EFFORT_KEY, reasoningEffortRef.current);
      } else {
        window.sessionStorage.removeItem(PENDING_REASONING_EFFORT_KEY);
      }
      if (isSearchMode && !isImageMode) {
        window.sessionStorage.setItem(PENDING_GENERATION_SEARCH_KEY, '1');
      } else {
        window.sessionStorage.removeItem(PENDING_GENERATION_SEARCH_KEY);
      }
      if (systemPrompt.trim().length > 0 && !isImageMode && !isVideoMode) {
        window.sessionStorage.setItem(PENDING_SYSTEM_PROMPT_KEY, systemPrompt.trim());
      } else {
        window.sessionStorage.removeItem(PENDING_SYSTEM_PROMPT_KEY);
      }
      router.push(`/c/${threadId}`);
      return true;
    } catch (error: unknown) {
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
    <div className="flex flex-col h-full bg-[#1a1520]">
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-3xl flex flex-col items-start px-4">
          {/* Main heading */}
          <h1 className="text-3xl md:text-4xl font-semibold text-zinc-100 mb-8 tracking-tight text-center md:text-left">
            How can I help you?
          </h1>

          {/* Category buttons */}
          <div className="flex flex-wrap justify-center md:justify-start gap-2 mb-10">

            {CATEGORIES.map((cat) => {
              const IconComponent = ICON_MAP[cat.icon];
              return (
                <Button
                  key={cat.label}
                  variant="ghost"
                  onClick={() => handleSuggestionClick(cat.prompt)}
                  className="h-10 px-4 gap-2 text-zinc-400 bg-transparent hover:bg-[#2a2035] border border-[#3a3045] rounded-full text-[15px] font-medium transition-all hover:text-zinc-100"
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
                className="w-full text-left px-0 py-2.5 text-base text-zinc-400/90 hover:text-zinc-200 transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Terms and Privacy Policy */}
        <div className="absolute bottom-24 left-0 right-0 text-center">
          <p className="text-xs text-zinc-500">
            Make sure you agree to our{' '}
            <span className="underline cursor-pointer hover:text-zinc-400">Terms</span>
            {' '}and our{' '}
            <span className="underline cursor-pointer hover:text-zinc-400">Privacy Policy</span>
          </p>
        </div>
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
    </div>
  );
}
