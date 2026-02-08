'use client';

import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ArrowUp, Square, ChevronUp, ChevronDown, Paperclip, Check, Sparkles, Search, Globe, Brain } from 'lucide-react';
import { AVAILABLE_MODELS } from '@/lib/constants';
import { cn } from '@/lib/utils';

export type ReasoningEffort = 'low' | 'medium' | 'high';

interface ChatInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onStop: () => void;
    isLoading: boolean;
    currentModel: string;
    onModelChange: (model: string) => void;
    reasoningEffort: ReasoningEffort;
    onReasoningEffortChange: (effort: ReasoningEffort) => void;
}

const REASONING_OPTIONS: { value: ReasoningEffort; label: string; pro?: boolean }[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium', pro: true },
    { value: 'high', label: 'High', pro: true },
];

export function ChatInput({
    value,
    onChange,
    onSubmit,
    onStop,
    isLoading,
    currentModel,
    onModelChange,
    reasoningEffort,
    onReasoningEffortChange,
}: ChatInputProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const selectedModel = AVAILABLE_MODELS.find((m) => m.id === currentModel) ?? AVAILABLE_MODELS[0];
    const selectedReasoning = REASONING_OPTIONS.find(r => r.value === reasoningEffort) ?? REASONING_OPTIONS[0];

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
        }
    }, [value]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isLoading && value?.trim()) {
                onSubmit();
            }
        }
    };

    return (
        <div className="p-4 bg-[#1a1520]">
            <div className="max-w-3xl mx-auto">
                {/* Input Container */}
                <div className="relative rounded-2xl bg-[#252030] border border-[#3a3045]">
                    {/* Textarea */}
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type your message here..."
                        disabled={isLoading}
                        rows={1}
                        className="w-full px-4 pt-4 pb-14 bg-transparent text-zinc-100 placeholder:text-zinc-500 focus:outline-none resize-none disabled:opacity-50 min-h-[56px]"
                    />

                    {/* Bottom Bar */}
                    <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 pb-3">
                        {/* Left side - Model selector and tools */}
                        <div className="flex items-center gap-1">
                            {/* Model Selector */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className="h-8 px-2.5 gap-1.5 text-zinc-300 hover:text-zinc-100 hover:bg-[#3a3045] rounded-lg text-sm"
                                    >
                                        <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                                        <span className="text-sm">{selectedModel.name}</span>
                                        <ChevronDown className="h-3 w-3 opacity-60" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="start"
                                    side="top"
                                    className="w-80 bg-[#1a1520] border-[#3a3045] shadow-2xl mb-2 max-h-[400px] overflow-y-auto"
                                >
                                    {/* Search */}
                                    <div className="p-2 border-b border-[#2a2535]">
                                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#252030]">
                                            <Search className="h-4 w-4 text-zinc-500" />
                                            <input
                                                type="text"
                                                placeholder="Search models..."
                                                className="flex-1 bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
                                            />
                                        </div>
                                    </div>

                                    {/* Model List */}
                                    <div className="py-1">
                                        {AVAILABLE_MODELS.map((model) => (
                                            <DropdownMenuItem
                                                key={model.id}
                                                onClick={() => onModelChange(model.id)}
                                                className={cn(
                                                    'flex items-start gap-3 py-3 px-3 cursor-pointer focus:bg-[#2a2535]',
                                                    model.id === currentModel && 'bg-[#2a2535]'
                                                )}
                                            >
                                                <Sparkles className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-zinc-100">{model.name}</span>
                                                        {model.id === currentModel && (
                                                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                                                        )}
                                                    </div>
                                                    <span className="text-xs text-zinc-500 block">{model.description}</span>
                                                </div>
                                            </DropdownMenuItem>
                                        ))}
                                    </div>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {/* Reasoning Effort Selector */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className="h-8 px-2.5 gap-1.5 text-zinc-300 hover:text-zinc-100 hover:bg-[#3a3045] rounded-lg text-sm"
                                    >
                                        <Brain className="h-3.5 w-3.5 text-zinc-400" />
                                        <span className="text-sm capitalize">{selectedReasoning.label}</span>
                                        <ChevronUp className="h-3 w-3 opacity-60" />
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
                                                'flex items-center gap-2 py-2.5 px-3 cursor-pointer focus:bg-[#2a2535]',
                                                option.value === reasoningEffort && 'bg-[#2a2535]'
                                            )}
                                        >
                                            <Brain className="h-4 w-4 text-zinc-400" />
                                            <span className="text-zinc-100">{option.label}</span>
                                            {option.pro && (
                                                <span className="text-[10px] text-zinc-500 ml-auto">Pro</span>
                                            )}
                                            {option.value === reasoningEffort && (
                                                <Check className="h-3.5 w-3.5 text-emerald-400 ml-auto" />
                                            )}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {/* Search Button */}
                            <Button
                                variant="ghost"
                                className="h-8 px-2.5 gap-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-[#3a3045] rounded-lg text-sm"
                            >
                                <Globe className="h-3.5 w-3.5" />
                                <span className="text-sm">Search</span>
                            </Button>

                            {/* Attachment */}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-zinc-500 hover:text-zinc-300 hover:bg-[#3a3045] rounded-lg"
                                title="Attach file"
                            >
                                <Paperclip className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Right side - Send/Stop button */}
                        {isLoading ? (
                            <Button
                                type="button"
                                size="icon"
                                onClick={onStop}
                                className="h-8 w-8 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400"
                            >
                                <Square className="h-3.5 w-3.5 fill-current" />
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                size="icon"
                                onClick={onSubmit}
                                disabled={!value?.trim()}
                                className="h-8 w-8 rounded-lg bg-pink-600 hover:bg-pink-500 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <ArrowUp className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
