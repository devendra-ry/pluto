'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';

export function useCopyToClipboard() {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copyingRef = useRef(false);
    const mountedRef = useRef(true);
    const { showToast } = useToast();

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (timerRef.current !== null) clearTimeout(timerRef.current);
        };
    }, []);

    const copy = useCallback(async (text: string) => {
        if (copyingRef.current) return;
        copyingRef.current = true;
        try {
            await navigator.clipboard.writeText(text);
            if (!mountedRef.current) return;
            if (timerRef.current !== null) clearTimeout(timerRef.current);
            setCopied(true);
            showToast('Copied to clipboard!', 'success');
            timerRef.current = setTimeout(() => setCopied(false), 2000);
        } catch {
            if (mountedRef.current) showToast('Unable to copy. Please try again.', 'error');
        } finally {
            copyingRef.current = false;
        }
    }, [showToast]);

    return { copied, copy };
}
