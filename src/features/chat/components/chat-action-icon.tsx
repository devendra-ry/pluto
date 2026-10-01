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
                    type="button"
                    aria-label={title}
                    title={title}
                    onClick={onClick}
                className={cn(
                    "p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-[color,background-color,border-color,box-shadow,opacity,transform]",
                    className
                )}
            >
                <Icon className="h-[1.1rem] w-[1.1rem]" />
            </button>
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover/icon:block group-focus-within/icon:block z-[100] pointer-events-none">
                <div role="tooltip" className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[11px] font-medium tracking-tight text-popover-foreground shadow-xl motion-surface">
                    {title}
                </div>
            </div>
        </div>
    );
}
