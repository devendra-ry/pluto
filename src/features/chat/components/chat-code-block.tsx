'use client';

import { Children, isValidElement, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { useCopyToClipboard } from '@/shared/hooks/use-copy-to-clipboard';

function textContent(children: ReactNode): string {
    return Children.toArray(children).map(child => {
        if (typeof child === 'string' || typeof child === 'number') return String(child);
        if (isValidElement<{ children?: ReactNode }>(child)) return textContent(child.props.children);
        return '';
    }).join('');
}

export function ChatCodeBlock({ children }: { children: ReactNode }) {
    const { copied, copy } = useCopyToClipboard();
    const code = Children.toArray(children).find(child => isValidElement(child));
    const language = isValidElement<{ className?: string }>(code)
        ? code.props.className?.match(/language-([^\s]+)/)?.[1]
        : undefined;
    return (
        <div className="not-prose my-4 overflow-hidden rounded-xl border border-border bg-popover">
            <div className="flex items-center justify-between border-b border-border bg-secondary/60 px-4 py-1.5">
                <span className="font-mono text-xs text-muted-foreground">{language || 'Code'}</span>
                <button type="button" aria-label={copied ? 'Code copied' : 'Copy code'} onClick={() => void copy(textContent(children))} className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
            <pre className="m-0 overflow-x-auto p-4 font-mono text-sm leading-relaxed text-foreground">{children}</pre>
        </div>
    );
}
