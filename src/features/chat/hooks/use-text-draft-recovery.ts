'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_TEXT_DRAFT_MAX_CHARS, loadTextDraft, saveTextDraft } from '../lib/text-draft-storage';

const SAVE_DELAY_MS = 350;
const CLEAR_DRAFTS_EVENT = 'pluto:clear-text-drafts';

export function useTextDraftRecovery(userId: string | null, scopeId: string) {
    const [restoredText, setRestoredText] = useState('');
    const [isLoaded, setIsLoaded] = useState(false);
    const [saveWarning, setSaveWarning] = useState('');
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestTextRef = useRef('');
    const activeKeyRef = useRef(`${userId ?? 'anonymous'}\u0000${scopeId}`);
    const suppressFlushRef = useRef(false);

    const write = useCallback((text: string) => {
        if (typeof window === 'undefined') return false;
        try {
            return saveTextDraft(window.localStorage, userId, scopeId, text);
        } catch {
            // Accessing localStorage itself can throw in privacy-restricted contexts.
            return false;
        }
    }, [scopeId, userId]);

    const clear = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        latestTextRef.current = '';
        suppressFlushRef.current = true;
        setSaveWarning('');
        if (typeof window !== 'undefined') {
            try { saveTextDraft(window.localStorage, userId, scopeId, ''); } catch { /* best effort */ }
        }
        setRestoredText('');
    }, [scopeId, userId]);

    const update = useCallback((text: string) => {
        latestTextRef.current = text;
        suppressFlushRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            const textToSave = latestTextRef.current;
            const saved = write(textToSave);
            setSaveWarning(saved ? '' : textToSave.length > CHAT_TEXT_DRAFT_MAX_CHARS
                ? 'This draft is too long to save on this device.'
                : 'This draft could not be saved on this device.');
        }, SAVE_DELAY_MS);
    }, [write]);

    const beginSubmission = useCallback((text: string) => {
        latestTextRef.current = text;
        suppressFlushRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        const saved = write(text);
        setSaveWarning(saved ? '' : text.length > CHAT_TEXT_DRAFT_MAX_CHARS
            ? 'This draft is too long to save on this device.'
            : 'This draft could not be saved on this device.');
    }, [write]);

    useEffect(() => {
        const activeKey = `${userId ?? 'anonymous'}\u0000${scopeId}`;
        activeKeyRef.current = activeKey;
        latestTextRef.current = '';
        suppressFlushRef.current = false;
        setIsLoaded(false);
        let recovered = '';
        try {
            recovered = loadTextDraft(window.localStorage, userId, scopeId);
        } catch {
            // Accessing localStorage itself can throw in privacy-restricted contexts.
        }
        latestTextRef.current = recovered;
        setRestoredText(recovered);
        setIsLoaded(true);

        const flush = () => {
            if (activeKeyRef.current !== activeKey || suppressFlushRef.current) return;
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = null;
            write(latestTextRef.current);
        };
        const suspendFlush = () => {
            suppressFlushRef.current = true;
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = null;
        };
        window.addEventListener('pagehide', flush);
        window.addEventListener(CLEAR_DRAFTS_EVENT, suspendFlush);
        return () => {
            window.removeEventListener('pagehide', flush);
            window.removeEventListener(CLEAR_DRAFTS_EVENT, suspendFlush);
            if (activeKeyRef.current === activeKey && !suppressFlushRef.current) {
                if (timerRef.current) clearTimeout(timerRef.current);
                timerRef.current = null;
                write(latestTextRef.current);
            }
        };
    }, [scopeId, userId, write]);

    useEffect(() => {
        const resetHomeDraft = () => {
            if (scopeId === 'home') clear();
        };
        window.addEventListener('pluto:new_chat', resetHomeDraft);
        return () => window.removeEventListener('pluto:new_chat', resetHomeDraft);
    }, [clear, scopeId]);

    return { restoredText, isLoaded, saveWarning, update, beginSubmission, clear };
}
