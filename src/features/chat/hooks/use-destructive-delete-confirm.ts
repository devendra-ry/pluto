'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type DestructiveDeleteAction = 'retry' | 'edit';

export type DestructiveDeleteConfirm = {
    action: DestructiveDeleteAction;
    deleteCount: number;
    resolve: (confirmed: boolean) => void;
};

export function useDestructiveDeleteConfirm() {
    const [deleteConfirm, setDeleteConfirm] = useState<DestructiveDeleteConfirm | null>(null);
    const pendingRef = useRef<DestructiveDeleteConfirm | null>(null);

    useEffect(() => () => {
        pendingRef.current?.resolve(false);
        pendingRef.current = null;
    }, []);

    const confirmDestructiveDelete = useCallback((context: {
        action: DestructiveDeleteAction;
        deleteCount: number;
    }) => {
        return new Promise<boolean>((resolve) => {
            // Replacing a dialog must also settle its previous caller.
            pendingRef.current?.resolve(false);
            const next = {
                action: context.action,
                deleteCount: context.deleteCount,
                resolve,
            };
            pendingRef.current = next;
            setDeleteConfirm(next);
        });
    }, []);

    const closeDeleteConfirm = useCallback((confirmed: boolean) => {
        const current = pendingRef.current;
        pendingRef.current = null;
        current?.resolve(confirmed);
        setDeleteConfirm(null);
    }, []);

    return {
        deleteConfirm,
        confirmDestructiveDelete,
        closeDeleteConfirm,
    };
}
