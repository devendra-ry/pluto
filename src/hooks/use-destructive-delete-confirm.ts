'use client';

import { useCallback, useState } from 'react';

export type DestructiveDeleteAction = 'retry' | 'edit';

export type DestructiveDeleteConfirm = {
    action: DestructiveDeleteAction;
    deleteCount: number;
    resolve: (confirmed: boolean) => void;
};

export function useDestructiveDeleteConfirm() {
    const [deleteConfirm, setDeleteConfirm] = useState<DestructiveDeleteConfirm | null>(null);

    const confirmDestructiveDelete = useCallback((context: {
        action: DestructiveDeleteAction;
        deleteCount: number;
    }) => {
        return new Promise<boolean>((resolve) => {
            setDeleteConfirm({
                action: context.action,
                deleteCount: context.deleteCount,
                resolve,
            });
        });
    }, []);

    const closeDeleteConfirm = useCallback((confirmed: boolean) => {
        setDeleteConfirm((current) => {
            if (current) {
                current.resolve(confirmed);
            }
            return null;
        });
    }, []);

    return {
        deleteConfirm,
        confirmDestructiveDelete,
        closeDeleteConfirm,
    };
}
