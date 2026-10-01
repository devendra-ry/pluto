'use client';

import { useState, useEffect, useRef } from 'react';
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
                        aria-label={`Reasoning effort: ${selectedReasoning.label}`}
                        className="h-8 px-2 md:px-3 gap-1.5 md:gap-2 text-muted-foreground hover:text-foreground bg-secondary hover:bg-accent border border-border rounded-xl transition-[color,background-color,border-color,box-shadow,opacity,transform] text-sm font-semibold"
                    >
                        <Brain className="h-3.5 w-3.5 md:h-4 md:w-4" />
                        <span className="capitalize hidden md:inline">{selectedReasoning.label}</span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    side="top"
                    className="w-44 bg-popover border-input shadow-2xl mb-2"
                >
                    {REASONING_OPTIONS.map((option) => (
                        <DropdownMenuItem
                            key={option.value}
                            onClick={() => onReasoningEffortChange(option.value)}
                            className={cn(
                                'flex items-center gap-3 py-2 px-3 cursor-pointer focus:bg-accent',
                                option.value === reasoningEffort && 'bg-accent'
                            )}
                        >
                            <Brain className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-foreground flex-1">{option.label}</span>
                            {option.value === reasoningEffort && (
                                <Check className="h-4 w-4 text-success shrink-0" />
                            )}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

            <div className="absolute bottom-full mb-2 hidden group-hover/reasoning:block group-focus-within/reasoning:block z-50 pointer-events-none">
                <div className="bg-popover backdrop-blur-md text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-border font-semibold tracking-tight motion-surface">
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
    const savingRef = useRef(false);
    const { showToast } = useToast();

    useEffect(() => {
        setSystemPromptDraft(systemPrompt);
    }, [systemPrompt]);

    const hasSystemPrompt = systemPrompt.trim().length > 0;

    const handleSaveSystemPrompt = async () => {
        if (savingRef.current) return;
        if (!onSystemPromptChange) {
            setIsSystemMenuOpen(false);
            return;
        }
        savingRef.current = true;
        setIsSavingSystemPrompt(true);
        try {
            await onSystemPromptChange(systemPromptDraft);
            setIsSystemMenuOpen(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to save system prompt';
            showToast(message, 'error');
        } finally {
            savingRef.current = false;
            setIsSavingSystemPrompt(false);
        }
    };

    const handleClearSystemPrompt = async () => {
        if (savingRef.current) return;
        setSystemPromptDraft('');
        if (!onSystemPromptChange) {
            setIsSystemMenuOpen(false);
            return;
        }
        savingRef.current = true;
        setIsSavingSystemPrompt(true);
        try {
            await onSystemPromptChange('');
            setIsSystemMenuOpen(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to clear system prompt';
            showToast(message, 'error');
        } finally {
            savingRef.current = false;
            setIsSavingSystemPrompt(false);
        }
    };

    return (
        <DropdownMenu open={isSystemMenuOpen} onOpenChange={setIsSystemMenuOpen}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    type="button"
                    aria-label="System prompt"
                    className={cn(
                        "shrink-0 h-8 px-2 md:px-3 gap-1.5 md:gap-2 border rounded-xl transition-[color,background-color,border-color,box-shadow,opacity,transform] text-sm font-semibold",
                        hasSystemPrompt
                            ? "text-brand-300 bg-primary/10 hover:bg-primary/20 border-ring/50"
                            : "text-muted-foreground hover:text-foreground bg-secondary hover:bg-accent border-border"
                    )}
                >
                    <ScrollText className="h-3.5 w-3.5 md:h-4 md:w-4" />
                    <span className="hidden md:inline">System</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                side="top"
                className="w-[min(90vw,420px)] p-3 bg-popover border-input shadow-2xl mb-2"
                onCloseAutoFocus={(e) => e.preventDefault()}
            >
                <div className="space-y-2">
                    <p className="text-xs text-foreground font-semibold tracking-tight">
                        System Prompt (chat only)
                    </p>
                    <Textarea
                        aria-label="System prompt instructions"
                        value={systemPromptDraft}
                        onChange={(e) => setSystemPromptDraft(e.target.value)}
                        placeholder="Set behavior, rules, or lore for this thread..."
                        className="min-h-[120px] max-h-[260px] resize-y rounded-xl bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
                    />
                    <p className="text-[11px] text-muted-foreground">
                        Applied to responses in this thread.
                    </p>
                    <div className="flex items-center justify-end gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => void handleClearSystemPrompt()}
                            disabled={isSavingSystemPrompt || (!hasSystemPrompt && systemPromptDraft.length === 0)}
                            className="h-8 px-3 text-foreground hover:text-foreground hover:bg-accent"
                        >
                            Clear
                        </Button>
                        <Button
                            type="button"
                            onClick={() => void handleSaveSystemPrompt()}
                            disabled={isSavingSystemPrompt}
                            className="h-8 px-3 bg-primary hover:bg-brand-600 text-primary-foreground"
                        >
                            Save
                        </Button>
                    </div>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
