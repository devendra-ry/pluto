'use client';

import { ArrowUpRight, BookOpen, Code, GraduationCap, Sparkles, Wand2, type LucideIcon } from 'lucide-react';

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

const CATEGORY_DESCRIPTIONS: Record<CategoryIconName, string> = {
    Wand2: 'Find your next great idea',
    BookOpen: 'Follow your curiosity',
    Code: 'Build something that works',
    GraduationCap: 'Make complex things clear',
};

export function ChatEmptyState({ onPromptClick }: ChatEmptyStateProps) {
    return (
        <div className="flex h-full w-full min-h-0 flex-col overflow-y-auto px-5 pb-8 pt-20 sm:px-8 sm:pt-8">
          <div className="m-auto w-full max-w-2xl py-4">
            <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-brand-400">
                    <Sparkles className="h-5 w-5" aria-hidden="true" />
                </div>
                <span className="text-[11px] font-semibold tracking-[0.2em] text-brand-300">YOUR AI WORKSPACE</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                How can I help you?
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">A fresh perspective, a little clarity, or your next big idea. Start here.</p>

            <div className="mt-7 grid grid-cols-2 gap-3" aria-label="Explore conversation starters">
                {CATEGORIES.map((cat) => {
                    const IconComponent = ICON_MAP[cat.icon];
                    return (
                        <button
                            key={cat.label}
                            type="button"
                            onClick={() => onPromptClick(cat.prompt)}
                            className="group rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-brand-400/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <div className="mb-3 flex items-center justify-between">
                                <IconComponent className="h-5 w-5 text-brand-300" aria-hidden="true" />
                                <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
                            </div>
                            <span className="block text-sm font-semibold text-foreground">{cat.label}</span>
                            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{CATEGORY_DESCRIPTIONS[cat.icon]}</span>
                        </button>
                    );
                })}
            </div>

            <p className="mb-2 mt-7 text-[11px] font-medium tracking-widest text-muted-foreground">OR TRY ASKING</p>
            <div className="divide-y divide-border/70">
                {SUGGESTED_PROMPTS.map(prompt => (
                    <button
                        key={prompt}
                        type="button"
                        onClick={() => onPromptClick(prompt)}
                        className="group flex w-full items-center justify-between gap-4 rounded-lg px-1 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <span>{prompt}</span>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-brand-300" aria-hidden="true" />
                    </button>
                ))}
            </div>

          </div>
        </div>
    );
}
