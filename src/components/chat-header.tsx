'use client';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ChevronDown, Check } from 'lucide-react';
import { AVAILABLE_MODELS } from '@/lib/constants';

interface ChatHeaderProps {
    currentModel: string;
    onModelChange: (modelId: string) => void;
}

export function ChatHeader({ currentModel, onModelChange }: ChatHeaderProps) {
    const selectedModel = AVAILABLE_MODELS.find((m) => m.id === currentModel) ?? AVAILABLE_MODELS[0];

    return (
        <header className="sticky top-0 z-50 flex items-center justify-between h-12 px-4 border-b border-zinc-800/50 bg-zinc-950/90 backdrop-blur-md">
            <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-400">Model:</span>
            </div>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        className="gap-2 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 h-8 px-3"
                    >
                        <span className="text-sm font-medium max-w-[200px] truncate">{selectedModel.name}</span>
                        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72 bg-zinc-900 border-zinc-700/50 shadow-xl">
                    <div className="px-2 py-1.5">
                        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Select Model</p>
                    </div>
                    <DropdownMenuSeparator className="bg-zinc-800" />
                    {AVAILABLE_MODELS.map((model) => (
                        <DropdownMenuItem
                            key={model.id}
                            onClick={() => onModelChange(model.id)}
                            className="flex items-start gap-3 py-2.5 px-2 cursor-pointer focus:bg-zinc-800"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-zinc-100">{model.name}</span>
                                    {model.id === currentModel && (
                                        <Check className="h-3.5 w-3.5 text-violet-400" />
                                    )}
                                </div>
                                <span className="text-xs text-zinc-500 block truncate">{model.description}</span>
                            </div>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </header>
    );
}
