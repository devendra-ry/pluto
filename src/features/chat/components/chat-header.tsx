'use client';

import { ChevronDown, Search } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FLUID_TRANSITION } from '@/shared/lib/motion';

interface ChatHeaderProps {
    showScrollButton: boolean;
    hasMessages: boolean;
    onScrollToBottom: () => void;
    onSearchMessages?: () => void;
}

export function ChatHeader({ showScrollButton, hasMessages, onScrollToBottom, onSearchMessages }: ChatHeaderProps) {
    const reduceMotion = useReducedMotion();
    return (
        <div className="relative w-full max-w-3xl mx-auto px-4">
            {onSearchMessages && hasMessages && (
                <button
                    type="button"
                    aria-label="Search messages"
                    title="Search this conversation"
                    onClick={onSearchMessages}
                    className="absolute -top-14 right-4 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-xl hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Search className="h-4 w-4" aria-hidden="true" />
                </button>
            )}
            <AnimatePresence>
                {showScrollButton && hasMessages && (
                    <motion.div
                        key="scroll-to-bottom"
                        initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
                        transition={reduceMotion ? { duration: 0 } : FLUID_TRANSITION}
                        className="absolute -top-14 left-1/2 -translate-x-1/2"
                    >
                        <button
                            onClick={onScrollToBottom}
                            className="h-9 px-4 rounded-full bg-card backdrop-blur-lg border border-border text-foreground hover:text-foreground hover:bg-accent shadow-2xl transition-[color,background-color,border-color,box-shadow,opacity,transform] flex items-center gap-2 group"
                        >
                            <span className="text-sm font-semibold tracking-tight">Scroll to bottom</span>
                            <ChevronDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
