'use client';

import { type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/core/utils';

export interface ActionIconProps {
    icon: LucideIcon;
    title: string;
    onClick?: () => void;
    className?: string;
}

export function ActionIcon({ icon: Icon, title, onClick, className }: ActionIconProps) {
    return (
        <div className="relative group/icon flex flex-col items-center">
            <button
                onClick={onClick}
                className={cn(
                    "p-2 rounded-lg text-zinc-400/70 hover:text-zinc-100 hover:bg-zinc-800/50 transition-all",
                    className
                )}
            >
                <Icon className="h-[1.1rem] w-[1.1rem]" />
            </button>
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover/icon:block z-[100] pointer-events-none">
                <div className="bg-zinc-950 text-white text-[11px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/5 font-medium tracking-tight animate-in fade-in zoom-in-95 duration-200">
                    {title}
                </div>
            </div>
        </div>
    );
}