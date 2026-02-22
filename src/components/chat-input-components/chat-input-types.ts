import { Attachment } from '@/lib/types';

export type ChatSubmitMode = 'chat' | 'image' | 'image-edit' | 'video' | 'search';

export interface ChatSubmitOptions {
    mode: ChatSubmitMode;
    imageModelId?: string;
}

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
    setMode: (mode: ChatSubmitMode) => void;
    setImageModelId: (modelId: string) => void;
    getMode: () => ChatSubmitMode;
    getImageModelId: () => string;
}
