'use client';

import { Brain, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/core/utils';
import { type ReasoningEffort } from '@/shared/core/types';

const REASONING_OPTIONS: { value: ReasoningEffort; label: string; pro?: boolean }[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
];

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
                        className="h-8 px-2 md:px-3 gap-1.5 md:gap-2 text-[#fce7ef] hover:text-white bg-[#2a2035]/30 hover:bg-[#2a2035]/50 border border-white/10 rounded-xl md:rounded-full transition-all text-sm font-semibold"
                    >
                        <Brain className="h-3.5 w-3.5 md:h-4 md:w-4" />
                        <span className="capitalize hidden md:inline">{selectedReasoning.label}</span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    side="top"
                    className="w-44 bg-[#1a1520] border-[#3a3045] shadow-2xl mb-2"
                >
                    {REASONING_OPTIONS.map((option) => (
                        <DropdownMenuItem
                            key={option.value}
                            onClick={() => onReasoningEffortChange(option.value)}
                            className={cn(
                                'flex items-center gap-3 py-2 px-3 cursor-pointer focus:bg-[#2a2535]',
                                option.value === reasoningEffort && 'bg-[#2a2535]'
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
                <div className="bg-[#1a1520]/95 backdrop-blur-md text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/10 font-semibold tracking-tight animate-in fade-in zoom-in-95 duration-200">
                    <span className="text-[#fce7ef]">Reasoning Effort</span>
                </div>
            </div>
        </div>
    );
}

