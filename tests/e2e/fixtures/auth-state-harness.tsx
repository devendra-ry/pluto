import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { ChatInput } from '../../../src/features/chat/components/chat-input';
import { ChatLayout } from '../../../src/features/shell/components/chat-layout';
import { QueryProvider } from '../../../src/shared/providers/query-provider';
import { ToastProvider } from '../../../src/components/ui/toast';
import { DEFAULT_MODEL, DEFAULT_REASONING_EFFORT } from '../../../src/shared/core/constants';
import type { User } from '@supabase/supabase-js';

declare global {
    interface Window {
        authStateMock: {
            setUser: (userId: string | null) => void;
            confirmServerUser: (userId: string | null) => void;
            seedCacheSentinel: () => void;
            refreshCount: number;
        };
    }
}

function CacheSentinel() {
    const queryClient = useQueryClient();
    const [, setRevision] = useState(0);

    useEffect(() => {
        return queryClient.getQueryCache().subscribe(() => setRevision(revision => revision + 1));
    }, [queryClient]);

    return <output data-testid="cache-sentinel">{String(queryClient.getQueryData(['account-sentinel']) ?? 'cleared')}</output>;
}

function Composer() {
    return (
        <ChatInput
            draftScopeId="home"
            onSubmit={() => true}
            isLoading={false}
            currentModel={DEFAULT_MODEL}
            onModelChange={() => {}}
            reasoningEffort={DEFAULT_REASONING_EFFORT}
            onReasoningEffortChange={() => {}}
        />
    );
}

function AuthStateContent() {
    const queryClient = useQueryClient();
    const [serverUserId, setServerUserId] = useState<string | null>('user-1');

    useEffect(() => {
        window.authStateMock.confirmServerUser = setServerUserId;
        window.authStateMock.seedCacheSentinel = () => {
            queryClient.setQueryData(['account-sentinel'], 'cached-for-user-1');
        };
    }, [queryClient]);

    return <>
        <CacheSentinel />
        <ChatLayout initialUser={(serverUserId ? { id: serverUserId } : null) as User | null}>
            <Composer />
        </ChatLayout>
    </>;
}

function Harness() {
    return <ToastProvider><QueryProvider><AuthStateContent /></QueryProvider></ToastProvider>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
