'use client';

import { BookOpen, Code, GraduationCap, Wand2, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CATEGORIES, SUGGESTED_PROMPTS } from '@/shared/core/constants';

interface ChatEmptyStateProps {
    onPromptClick: (prompt: string) => void;
}

const ICON_MAP: Record<string, LucideIcon> = {
    Wand2,
    BookOpen,
    Code,
    GraduationCap,
};

export function ChatEmptyState({ onPromptClick }: ChatEmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full px-4 pt-8">
            <h1 className="text-2xl md:text-3xl font-bold text-zinc-100 mb-6 text-center">
                How can I help you?
            </h1>

            <div className="flex flex-wrap justify-center gap-2 mb-8">
                {CATEGORIES.map((cat) => {
                    const IconComponent = ICON_MAP[cat.icon];
                    return (
                        <Button
                            key={cat.label}
                            variant="ghost"
                            onClick={() => onPromptClick(cat.prompt)}
                            className="h-9 px-4 gap-2 text-zinc-400 bg-transparent hover:bg-[#2a2035] border border-[#3a3045] rounded-full text-[15px]"
                        >
                            <IconComponent className="h-4 w-4" />
                            {cat.label}
                        </Button>
                    );
                })}
            </div>

            <div className="space-y-1 w-full max-w-md text-left">
                {SUGGESTED_PROMPTS.map((prompt, i) => (
                    <button
                        key={i}
                        onClick={() => onPromptClick(prompt)}
                        className="w-full text-left px-1 py-2 text-base text-pink-300/80 hover:text-pink-200 transition-colors"
                    >
                        {prompt}
                    </button>
                ))}
            </div>

            <div className="absolute bottom-12 left-0 right-0 text-center">
                <p className="text-xs text-zinc-500">
                    Make sure you agree to our{' '}
                    <span className="underline cursor-pointer hover:text-zinc-400">Terms</span>
                    {' '}and our{' '}
                    <span className="underline cursor-pointer hover:text-zinc-400">Privacy Policy</span>
                </p>
            </div>
        </div>
    );
}

