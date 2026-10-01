'use client';

import { BookOpen, Code, GraduationCap, Wand2, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CATEGORIES, SUGGESTED_PROMPTS, type CategoryIconName } from '@/shared/core/constants';

interface ChatEmptyStateProps {
    onPromptClick: (prompt: string) => void;
}

const ICON_MAP = {
    Wand2,
    BookOpen,
    Code,
    GraduationCap,
} satisfies Record<CategoryIconName, LucideIcon>;

export function ChatEmptyState({ onPromptClick }: ChatEmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full overflow-y-auto px-4 py-8">
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-6 text-center">
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
                            className="h-11 px-4 gap-2 text-muted-foreground bg-card hover:bg-accent hover:text-accent-foreground border border-border rounded-full text-[15px]"
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
                        className="w-full rounded-md text-left px-2 py-3 text-base text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                        {prompt}
                    </button>
                ))}
            </div>

            <div className="mt-8 text-center">
                <p className="text-xs text-muted-foreground">
                    Make sure you agree to our{' '}
                    <span className="underline">Terms</span>
                    {' '}and our{' '}
                    <span className="underline">Privacy Policy</span>
                </p>
            </div>
        </div>
    );
}
