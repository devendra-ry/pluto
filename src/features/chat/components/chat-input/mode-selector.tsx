'use client';

import { Check, Globe, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/core/utils';
import { ChatSubmitMode } from './chat-input-types';

const MODE_OPTIONS: Array<{
    value: ChatSubmitMode;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
}> = [
    { value: 'chat', label: 'Chat', icon: MessageSquare },
    { value: 'search', label: 'Search', icon: Globe },
];

interface ModeSelectorProps {
    activeMode: ChatSubmitMode;
    supportsSearchMode: boolean;
    isLoading: boolean;
    onModeChange: (mode: ChatSubmitMode) => void;
}

export function ModeSelector({
    activeMode,
    supportsSearchMode,
    isLoading,
    onModeChange,
}: ModeSelectorProps) {
    const activeModeOption = MODE_OPTIONS.find((option) => option.value === activeMode) ?? MODE_OPTIONS[0];

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    type="button"
                    disabled={isLoading}
                    className={cn(
                        "shrink-0 h-8 px-2 md:px-3 gap-1.5 md:gap-2 border rounded-xl md:rounded-full transition-all text-sm font-semibold",
                        activeMode !== 'chat'
                            ? "text-white bg-[#3d2d4a] hover:bg-[#4a3558] border-[#7a58a3]/70"
                            : "text-[#fce7ef] hover:text-white bg-[#2a2035]/30 hover:bg-[#2a2035]/50 border-white/10"
                    )}
                >
                    <activeModeOption.icon className="h-3.5 w-3.5 md:h-4 md:w-4" />
                    <span className="hidden md:inline">{activeModeOption.label}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                side="top"
                className="w-44 bg-[#1a1520] border-[#3a3045] shadow-2xl mb-2"
            >
                {MODE_OPTIONS.map((option) => (
                    <DropdownMenuItem
                        key={option.value}
                        disabled={option.value === 'search' && !supportsSearchMode}
                        onClick={() => onModeChange(option.value)}
                        className={cn(
                            "flex items-center gap-2 py-2 px-3 cursor-pointer focus:bg-[#2a2535]",
                            option.value === activeMode && "bg-[#2a2535]"
                        )}
                    >
                        <option.icon className="h-4 w-4 text-zinc-400 shrink-0" />
                        <span className="text-zinc-100 flex-1">{option.label}</span>
                        {option.value === activeMode && (
                            <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                        )}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
