'use client';

import { useRef, useEffect, forwardRef, useState, useImperativeHandle } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ArrowUp, Square, Paperclip, Check, Globe, Brain } from 'lucide-react';
import { AVAILABLE_MODELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { type ReasoningEffort } from '@/lib/types';
import { ModelSelector } from '@/components/model-selector';

export interface ChatInputHandle {
    setValue: (value: string) => void;
    focus: () => void;
}

interface ChatInputProps {
    initialValue?: string;
    onInputChange?: (value: string) => void; // Optional callback if parent needs current value
    onSubmit: (value: string) => void;
    onStop?: () => void;
    isLoading: boolean;
    currentModel: string;
    onModelChange: (model: string) => void;
    reasoningEffort: ReasoningEffort;
    onReasoningEffortChange: (effort: ReasoningEffort) => void;
}

const REASONING_OPTIONS: { value: ReasoningEffort; label: string; pro?: boolean }[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
];

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(({
    initialValue = '',
    onInputChange,
    onSubmit,
    onStop,
    isLoading,
    currentModel,
    onModelChange,
    reasoningEffort,
    onReasoningEffortChange,
}, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [value, setValue] = useState(initialValue);
    const selectedModel = AVAILABLE_MODELS.find((m) => m.id === currentModel) ?? AVAILABLE_MODELS[0];
    const selectedReasoning = REASONING_OPTIONS.find(r => r.value === reasoningEffort) ?? REASONING_OPTIONS[0];

    useImperativeHandle(ref, () => ({
        setValue: (newValue: string) => {
            setValue(newValue);
            // Adjust height after setting value
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.style.height = 'auto';
                    textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
                }
            });
        },
        focus: () => textareaRef.current?.focus(),
    }));

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
                handleSubmit();
            }
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        setValue(newValue);
        onInputChange?.(newValue);
    };

    const handleSubmit = () => {
        if (!value.trim()) return;
        onSubmit(value);
        setValue('');
    };

    return (
        <div className="pb-4 px-4 pt-0 bg-[#1a1520]">
            <div className="max-w-3xl mx-auto">
                {/* Input Container */}
                <div className="relative rounded-2xl bg-[#221c26] border border-[#302736]/60 shadow-xl transition-all duration-200">
                    {/* Textarea */}
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Type your message here..."
                        className="w-full px-5 pt-4 pb-14 bg-transparent text-zinc-100 placeholder:text-zinc-500/80 focus:outline-none resize-none min-h-[60px] text-[15px] leading-relaxed"
                    />

                    {/* Bottom Bar */}
                    <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 pb-3">
                        {/* Left side - Model selector and tools */}
                        <div className="flex items-center gap-3">
                            {/* Model Selector */}
                            <ModelSelector
                                currentModel={currentModel}
                                onModelChange={onModelChange}
                            />

                            {/* Reasoning Effort Selector - Pill style */}
                            {selectedModel.supportsReasoning && (
                                <div className="group/reasoning relative flex flex-col items-center">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                className="h-8 px-3 gap-2 text-[#fce7ef] hover:text-white bg-[#2a2035]/30 hover:bg-[#2a2035]/50 border border-white/10 rounded-full transition-all text-xs font-semibold"
                                            >
                                                <Brain className="h-4 w-4" />
                                                <span className="capitalize">{selectedReasoning.label}</span>
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

                                    {/* Custom Tooltip */}
                                    <div className="absolute bottom-full mb-2 hidden group-hover/reasoning:block z-50 pointer-events-none">
                                        <div className="bg-[#1a1520]/95 backdrop-blur-md text-[11px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/10 font-semibold tracking-tight animate-in fade-in zoom-in-95 duration-200">
                                            <span className="text-[#fce7ef]">Reasoning Effort</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Search Button - Pill style */}
                            <Button
                                variant="ghost"
                                className="h-8 px-3 gap-2 text-[#fce7ef] hover:text-white bg-[#2a2035]/30 hover:bg-[#2a2035]/50 border border-white/10 rounded-full transition-all text-xs font-semibold"
                            >
                                <Globe className="h-4 w-4" />
                                <span className="">Search</span>
                            </Button>

                            <div className="group/attach relative flex flex-col items-center">
                                <Button
                                    variant="ghost"
                                    className="h-8 w-11 p-0 text-[#fce7ef] hover:text-white bg-[#2a2035]/30 hover:bg-[#2a2035]/50 border border-white/10 rounded-full transition-all flex items-center justify-center"
                                >
                                    <Paperclip className="h-4 w-4" />
                                </Button>
                                <div className="absolute bottom-full mb-2 hidden group-hover/attach:block z-50 pointer-events-none">
                                    <div className="bg-[#1a1520]/95 backdrop-blur-md text-[11px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/10 font-semibold tracking-tight animate-in fade-in zoom-in-95 duration-200">
                                        <span className="text-[#fce7ef]">Attach file</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right side - Send/Stop button */}
                        {isLoading && onStop ? (
                            <Button
                                type="button"
                                size="icon"
                                onClick={onStop}
                                className="h-8 w-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all border border-red-500/20"
                            >
                                <Square className="h-3.5 w-3.5 fill-current" />
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                size="icon"
                                onClick={handleSubmit}
                                disabled={!value?.trim()}
                                className="h-8 w-8 rounded-lg bg-[#3a283e] hover:bg-[#4a354e] text-pink-300/80 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <ArrowUp className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});
ChatInput.displayName = 'ChatInput';
