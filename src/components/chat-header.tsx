'use client';

import { ChevronDown } from 'lucide-react';

interface ChatHeaderProps {
    showScrollButton: boolean;
    hasMessages: boolean;
    onScrollToBottom: () => void;
}

export function ChatHeader({ showScrollButton, hasMessages, onScrollToBottom }: ChatHeaderProps) {
    return (
        <div className="relative w-full max-w-3xl mx-auto px-4">
            {showScrollButton && hasMessages && (
                <div className="absolute -top-14 left-1/2 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <button
                        onClick={onScrollToBottom}
                        className="h-9 px-4 rounded-full bg-zinc-900/60 backdrop-blur-lg border border-white/5 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/80 shadow-2xl transition-all flex items-center gap-2 group"
                    >
                        <span className="text-sm font-semibold tracking-tight">Scroll to bottom</span>
                        <ChevronDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                    </button>
                </div>
            )}
        </div>
    );
}
