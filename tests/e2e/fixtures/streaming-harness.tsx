import { Profiler, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssistantMessage } from '../../../src/features/chat/components/chat-message-assistant';
import { ChatStreamMessageStoreProvider } from '../../../src/features/chat/components/chat-stream-message-store';
import { useChatStream } from '../../../src/features/chat/hooks/use-chat-stream';
import { ToastProvider } from '../../../src/components/ui/toast';
import type { ChatViewMessage } from '../../../src/shared/contracts/chat';
import type { ReasoningEffort } from '../../../src/shared/core/types';

declare global {
    interface Window {
        streamingTest: {
            requests: number;
            commits: number;
            result: boolean | null;
            failuresBeforeStream: number;
            start: () => void;
            delta: (content: string, reasoning?: string) => void;
            finish: () => void;
            fail: () => void;
            stop: () => void;
            publish: (content: string, reasoning: string) => void;
        };
    }
}

const encoder = new TextEncoder();
let source: ReadableStreamDefaultController<Uint8Array> | null = null;
const control = window.streamingTest = {
    requests: 0,
    commits: 0,
    result: null as boolean | null,
    failuresBeforeStream: 0,
    start: () => {},
    delta: (content: string, reasoning = '') => {
        source?.enqueue(encoder.encode(`data: ${JSON.stringify({ c: content, r: reasoning })}\n\n`));
    },
    finish: () => { source?.enqueue(encoder.encode('data: [DONE]\n\n')); source?.close(); source = null; },
    fail: () => { source?.enqueue(encoder.encode('data: {"error":"Playback interrupted"}\n\n')); source?.close(); source = null; },
    stop: () => {},
    publish: (_content: string, _reasoning: string) => {},
};

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== '/api/chat') return originalFetch(input, init);
    control.requests += 1;
    if (control.requests <= control.failuresBeforeStream) {
        return Response.json({ error: 'Unable to resume chat stream. Please retry the request.' }, { status: 409 });
    }
    let onAbort: () => void;
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            source = controller;
            onAbort = () => { controller.error(new DOMException('Stopped', 'AbortError')); source = null; };
            init?.signal?.addEventListener('abort', onAbort, { once: true });
        },
        cancel() { init?.signal?.removeEventListener('abort', onAbort); source = null; },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
};

function Harness() {
    const [messages, setMessages] = useState<ChatViewMessage[]>([{ id: 'user', role: 'user', content: 'Explain streaming' }]);
    const effort = useRef<ReasoningEffort>('high');
    const refresh = useCallback(async () => ({ ok: true as const }), []);
    const toast = useCallback(() => {}, []);
    const stream = useChatStream({
        chatId: 'playback', model: 'gemini-3.8-flash', reasoningEffortRef: effort,
        systemPrompt: '', setMessages, refreshPersistedReply: refresh, showToast: toast,
    });
    const { generateResponse, handleStop, streamedMessageStore } = stream;
    const assistant = messages.find(message => message.role === 'assistant');
    useLayoutEffect(() => {
        control.start = () => {
            void generateResponse(messages).then((result) => { control.result = result; });
        };
        control.stop = handleStop;
        control.publish = (content, reasoning) => {
            if (assistant) streamedMessageStore.publish(assistant.id, { content, reasoning });
        };
    }, [messages, assistant, generateResponse, handleStop, streamedMessageStore]);
    return <>
        <output data-testid="loading">{String(stream.isLoading)}</output>
        <output data-testid="failed">{String(stream.lastRequestFailed)}</output>
        <output data-testid="committed">{JSON.stringify(messages)}</output>
        <ChatStreamMessageStoreProvider store={stream.streamedMessageStore}>
            {assistant && <Profiler id="assistant" onRender={() => { control.commits += 1; }}>
                <AssistantMessage {...assistant} isStreaming={stream.isLoading} isThinking={stream.isThinking} />
            </Profiler>}
        </ChatStreamMessageStoreProvider>
    </>;
}

createRoot(document.getElementById('root')!).render(<ToastProvider><Harness /></ToastProvider>);
