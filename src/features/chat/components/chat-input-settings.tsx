'use client';

import { useState, useEffect } from 'react';
import { Brain, Check, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/core/utils';
import type { ReasoningEffort } from '@/shared/core/types';
import { useToast } from '@/components/ui/toast';

const REASONING_OPTIONS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
] as const satisfies readonly { value: ReasoningEffort; label: string; pro?: boolean }[];

interface ReasoningSelectorProps {
    reasoningEffort: ReasoningEffort;
    onReasoningEffortChange: (effort: ReasoningEffort) => void;
}

export function ReasoningSelector({ reasoningEffort, onReasoningEffortChange }: ReasoningSelectorProps) {
    const selectedReasoning = REASONING_OPTIONS.find(r => r.value === reasoningEffort) ?? REASONING_OPTIONS[0];

    return (
        <div className="group/reasoning relative flex shrink-0 flex-col items-center">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        className="h-8 px-2 md:px-3 gap-1.5 md:gap-2 text-brand-100 hover:text-white bg-plum-700/30 hover:bg-plum-700/50 border border-white/10 rounded-xl md:rounded-full transition-all text-sm font-semibold"
                    >
                        <Brain className="h-3.5 w-3.5 md:h-4 md:w-4" />
                        <span className="capitalize hidden md:inline">{selectedReasoning.label}</span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    side="top"
                    className="w-44 bg-plum-900 border-plum-600 shadow-2xl mb-2"
                >
                    {REASONING_OPTIONS.map((option) => (
                        <DropdownMenuItem
                            key={option.value}
                            onClick={() => onReasoningEffortChange(option.value)}
                            className={cn(
                                'flex items-center gap-3 py-2 px-3 cursor-pointer focus:bg-plum-700',
                                option.value === reasoningEffort && 'bg-plum-700'
                            )}
                        >
                            <Brain className="h-4 w-4 text-zinc-400 shrink-0" />
                            <span className="text-zinc-100 flex-1">{option.label}</span>
                            {option.value === reasoningEffort && (
                                <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                            )}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

            <div className="absolute bottom-full mb-2 hidden group-hover/reasoning:block z-50 pointer-events-none">
                <div className="bg-plum-900/95 backdrop-blur-md text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/10 font-semibold tracking-tight animate-in fade-in zoom-in-95 duration-200">
                    <span className="text-brand-100">Reasoning Effort</span>
                </div>
            </div>
        </div>
    );
}

interface SystemPromptSelectorProps {
    systemPrompt: string;
    onSystemPromptChange?: (prompt: string) => Promise<void> | void;
}

export function SystemPromptSelector({ systemPrompt, onSystemPromptChange }: SystemPromptSelectorProps) {
    const [isSystemMenuOpen, setIsSystemMenuOpen] = useState(false);
    const [systemPromptDraft, setSystemPromptDraft] = useState(systemPrompt);
    const [isSavingSystemPrompt, setIsSavingSystemPrompt] = useState(false);
    const { showToast } = useToast();

    useEffect(() => {
        setSystemPromptDraft(systemPrompt);
    }, [systemPrompt]);

    const hasSystemPrompt = systemPrompt.trim().length > 0;

    const handleSaveSystemPrompt = async () => {
        if (!onSystemPromptChange) {
            setIsSystemMenuOpen(false);
            return;
        }
        setIsSavingSystemPrompt(true);
        try {
            await onSystemPromptChange(systemPromptDraft);
            setIsSystemMenuOpen(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to save system prompt';
            showToast(message, 'error');
        } finally {
            setIsSavingSystemPrompt(false);
        }
    };

    const handleClearSystemPrompt = async () => {
        setSystemPromptDraft('');
        if (!onSystemPromptChange) {
            setIsSystemMenuOpen(false);
            return;
        }
        setIsSavingSystemPrompt(true);
        try {
            await onSystemPromptChange('');
            setIsSystemMenuOpen(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to clear system prompt';
            showToast(message, 'error');
        } finally {
            setIsSavingSystemPrompt(false);
        }
    };

    return (
        <DropdownMenu open={isSystemMenuOpen} onOpenChange={setIsSystemMenuOpen}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    type="button"
                    className={cn(
                        "shrink-0 h-8 px-2 md:px-3 gap-1.5 md:gap-2 border rounded-xl md:rounded-full transition-all text-sm font-semibold",
                        hasSystemPrompt
                            ? "text-white bg-plum-600 hover:bg-plum-600 border-brand-400/70"
                            : "text-brand-100 hover:text-white bg-plum-700/30 hover:bg-plum-700/50 border-white/10"
                    )}
                >
                    <ScrollText className="h-3.5 w-3.5 md:h-4 md:w-4" />
                    <span className="hidden md:inline">System</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                side="top"
                className="w-[min(90vw,420px)] p-3 bg-plum-900 border-plum-600 shadow-2xl mb-2"
                onCloseAutoFocus={(e) => e.preventDefault()}
            >
                <div className="space-y-2">
                    <p className="text-xs text-zinc-300 font-semibold tracking-tight">
                        System Prompt (chat only)
                    </p>
                    <Textarea
                        value={systemPromptDraft}
                        onChange={(e) => setSystemPromptDraft(e.target.value)}
                        placeholder="Set behavior, rules, or lore for this thread..."
                        className="min-h-[120px] max-h-[260px] resize-y rounded-xl bg-plum-950 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-primary/70"
                    />
                    <p className="text-[11px] text-zinc-500">
                        Applied to responses in this thread.
                    </p>
                    <div className="flex items-center justify-end gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => void handleClearSystemPrompt()}
                            disabled={isSavingSystemPrompt || (!hasSystemPrompt && systemPromptDraft.length === 0)}
                            className="h-8 px-3 text-zinc-300 hover:text-zinc-100 hover:bg-plum-700"
                        >
                            Clear
                        </Button>
                        <Button
                            type="button"
                            onClick={() => void handleSaveSystemPrompt()}
                            disabled={isSavingSystemPrompt}
                            className="h-8 px-3 bg-plum-600 hover:bg-plum-600 text-brand-200"
                        >
                            Save
                        </Button>
                    </div>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
