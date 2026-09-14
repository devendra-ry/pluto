import { Attachment } from '@/shared/core/types';

export type LocalAttachmentStatus = 'uploading' | 'uploaded' | 'failed';

export interface LocalAttachmentItem {
    localId: string;
    file: File;
    status: LocalAttachmentStatus;
    progress: number;
    attachment?: Attachment;
    error?: string;
}

export interface ChatInputHandle {
    setValue: (value: string) => void;
    focus: () => void;
}
