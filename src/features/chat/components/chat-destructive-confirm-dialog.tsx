'use client';

import { type DestructiveDeleteConfirm } from '../hooks/use-destructive-delete-confirm';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';

interface ChatDestructiveConfirmDialogProps {
    confirm: DestructiveDeleteConfirm | null;
    onClose: (confirmed: boolean) => void;
}

export function ChatDestructiveConfirmDialog({ confirm, onClose }: ChatDestructiveConfirmDialogProps) {
    return (
        <Dialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) onClose(false); }}>
            <DialogContent>
                <DialogTitle>
                    Confirm history rewrite
                </DialogTitle>
                <DialogDescription>
                    {confirm ? (confirm.action === 'retry'
                        ? `Retry will remove ${confirm.deleteCount} later message${confirm.deleteCount === 1 ? '' : 's'} from this thread and regenerate from that point.`
                        : `Edit & resend will remove ${confirm.deleteCount} later message${confirm.deleteCount === 1 ? '' : 's'} from this thread and regenerate from the edited message.`) : null}
                </DialogDescription>
                <p className="-mt-2 text-sm text-muted-foreground">
                    This is now a soft delete and can be restored from audit history.
                </p>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onClose(false)}>
                        Cancel
                    </Button>
                    <Button variant="destructive" onClick={() => onClose(true)}>
                        Confirm
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
