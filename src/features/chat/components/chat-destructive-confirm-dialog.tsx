'use client';

import { type DestructiveDeleteConfirm } from '@/features/chat/hooks/use-destructive-delete-confirm';

interface ChatDestructiveConfirmDialogProps {
    confirm: DestructiveDeleteConfirm | null;
    onClose: (confirmed: boolean) => void;
}

export function ChatDestructiveConfirmDialog({ confirm, onClose }: ChatDestructiveConfirmDialogProps) {
    if (!confirm) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => onClose(false)}
        >
            <div
                className="w-full max-w-md rounded-xl border border-[#3a2a40] bg-[#17101c] p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-history-title"
            >
                <h2 id="delete-history-title" className="text-base font-semibold text-zinc-100">
                    Confirm history rewrite
                </h2>
                <p className="mt-2 text-sm text-zinc-400">
                    {confirm.action === 'retry'
                        ? `Retry will remove ${confirm.deleteCount} later message${confirm.deleteCount === 1 ? '' : 's'} from this thread and regenerate from that point.`
                        : `Edit & resend will remove ${confirm.deleteCount} later message${confirm.deleteCount === 1 ? '' : 's'} from this thread and regenerate from the edited message.`}
                </p>
                <p className="mt-1 text-sm text-zinc-400">
                    This is now a soft delete and can be restored from audit history.
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                    <button
                        className="rounded-md border border-white/20 px-3 py-2 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-white/10"
                        onClick={() => onClose(false)}
                    >
                        Cancel
                    </button>
                    <button
                        className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500"
                        onClick={() => onClose(true)}
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
}
