'use client';

import { useState, useEffect, useRef } from 'react';
import { Brain, Check, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
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
                        className="h-10 px-3 gap-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-xl transition-colors text-sm font-medium"
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
    const triggerRef = useRef<HTMLButtonElement>(null);
    const { showToast } = useToast();

    useEffect(() => {
        if (!isSystemMenuOpen) setSystemPromptDraft(systemPrompt);
    }, [systemPrompt, isSystemMenuOpen]);

    const hasSystemPrompt = systemPrompt.trim().length > 0;
    const promptTooLong = systemPromptDraft.length > 50_000;

    const handleSaveSystemPrompt = async () => {
        if (savingRef.current || promptTooLong) return;
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
        <Dialog open={isSystemMenuOpen} onOpenChange={open => { if (!savingRef.current) setIsSystemMenuOpen(open); }}>
                <Button
                    ref={triggerRef}
                    variant="ghost"
                    type="button"
                    aria-label="System prompt"
                    aria-haspopup="dialog"
                    aria-expanded={isSystemMenuOpen}
                    onClick={() => setIsSystemMenuOpen(true)}
                    className={cn(
                        "shrink-0 h-10 px-3 gap-2 rounded-xl transition-colors text-sm font-medium",
                        hasSystemPrompt
                            ? "text-brand-300 bg-primary/10 hover:bg-primary/20 border-ring/50"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                >
                    <ScrollText className="h-3.5 w-3.5 md:h-4 md:w-4" />
                    <span className="hidden md:inline">System</span>
                </Button>
            <DialogContent className="max-w-lg" onCloseAutoFocus={event => { event.preventDefault(); triggerRef.current?.focus(); }}>
                <div className="space-y-2">
                    <DialogTitle>Customize this conversation</DialogTitle>
                    <DialogDescription>Set the tone, context, or instructions Pluto should follow in this chat.</DialogDescription>
                    <Textarea
                        aria-label="System prompt instructions"
                        aria-invalid={promptTooLong || undefined}
                        aria-describedby="system-prompt-help"
                        value={systemPromptDraft}
                        onChange={(e) => setSystemPromptDraft(e.target.value)}
                        disabled={isSavingSystemPrompt}
                        autoFocus
                        placeholder="Set behavior, rules, or lore for this thread..."
                        className="min-h-[120px] max-h-[260px] resize-y rounded-xl bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
                    />
                    <p id="system-prompt-help" role={promptTooLong ? 'alert' : undefined} className={`text-xs ${promptTooLong ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {promptTooLong ? 'Instructions exceed 50,000 characters. Shorten them to save.' : 'Applied to responses in this thread. Maximum 50,000 characters.'}
                    </p>
                    <DialogFooter className="pt-3">
                        <Button type="button" variant="ghost" onClick={() => setIsSystemMenuOpen(false)} disabled={isSavingSystemPrompt}>Cancel</Button>
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
                            disabled={isSavingSystemPrompt || promptTooLong}
                            className="h-8 px-3 bg-primary hover:bg-brand-600 text-primary-foreground"
                        >
                            {isSavingSystemPrompt ? 'Saving…' : 'Save'}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
