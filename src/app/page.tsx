'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createThread } from '@/hooks/use-threads';
import { addMessage } from '@/hooks/use-messages';
import { DEFAULT_MODEL, SUGGESTED_PROMPTS, CATEGORIES, DEFAULT_REASONING_EFFORT, IMAGE_GENERATION_MODEL, PENDING_GENERATION_MODEL_KEY, PENDING_GENERATION_THREAD_KEY } from '@/lib/constants';
import { ChatInput, type ChatInputHandle } from '@/components/chat-input';
import { type Attachment, type ReasoningEffort } from '@/lib/types';
import { Button } from '@/components/ui/button';
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
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
  const [isLoading, setIsLoading] = useState(false);
  const [draftThreadId, setDraftThreadId] = useState<string | null>(null);

  const ensureThread = async () => {
    if (draftThreadId) {
      return draftThreadId;
    }

    const thread = await createThread(model, reasoningEffort);
    setDraftThreadId(thread.id);
    return thread.id;
  };

  const handleSend = async (
    value: string,
    attachments: Attachment[],
    options: { mode: 'chat' | 'image' }
  ) => {
    if (!value.trim() && attachments.length === 0) return false;
    const isImageMode = options.mode === 'image';
    const targetModel = isImageMode ? IMAGE_GENERATION_MODEL : null;

    setIsLoading(true);
    try {
      // 1. Ensure thread exists (attachments may have already created one)
      const threadId = await ensureThread();

      // 2. Add the user message
      await addMessage(threadId, 'user', value.trim(), undefined, undefined, attachments);

      // 3. Navigate to the new chat
      // The ChatPageClient will pick up the user message and start generating
      window.sessionStorage.setItem(PENDING_GENERATION_THREAD_KEY, threadId);
      if (targetModel) {
        window.sessionStorage.setItem(PENDING_GENERATION_MODEL_KEY, targetModel);
      } else {
        window.sessionStorage.removeItem(PENDING_GENERATION_MODEL_KEY);
      }
      router.push(`/c/${threadId}`);
      return true;
    } catch (error: unknown) {
      console.error('Failed to create chat:', error);
      const errorRecord = toErrorRecord(error);

      const errorMessage = typeof errorRecord.message === 'string'
        ? errorRecord.message
        : typeof errorRecord.error_description === 'string'
          ? errorRecord.error_description
          : String(error);
      const errorDetails = typeof errorRecord.details === 'string' ? errorRecord.details : '';
      const errorHint = typeof errorRecord.hint === 'string' ? errorRecord.hint : '';
      const errorStack = typeof errorRecord.stack === 'string' ? errorRecord.stack : '';

      console.error('--- ERROR DEBUG START ---');
      console.error('Message:', errorMessage);
      console.error('Details:', errorDetails);
      console.error('Hint:', errorHint);
      console.error('Stack:', errorStack);
      console.error('Raw Error Object:', error);
      try {
        console.error('Internal Properties:', Object.getOwnPropertyNames(errorRecord).reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = errorRecord[key];
          return acc;
        }, {}));
      } catch {
        console.error('Could not log internal properties');
      }
      console.error('--- ERROR DEBUG END ---');

      alert(`Failed to create chat: ${errorMessage}`);
      setIsLoading(false);
      return false;
    }
  };

  const handlePromptClick = (prompt: string) => {
    if (chatInputRef.current) {
      chatInputRef.current.setValue(prompt);
      chatInputRef.current.focus();
    }
  };

  const handleCategoryClick = (prompt: string) => {
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
                  onClick={() => handleCategoryClick(cat.prompt)}
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
                onClick={() => handlePromptClick(prompt)}
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
        onModelChange={setModel}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={setReasoningEffort}
      />
    </div>
  );
}
