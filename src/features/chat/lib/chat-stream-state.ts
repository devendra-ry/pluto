import type { ChatResponseStats } from './chat-view';

export type StreamPhase = 'idle' | 'preparing' | 'requesting' | 'streaming' | 'persisting';

export interface StreamState {
    phase: StreamPhase;
    isThinking: boolean;
    activeUserMessageId: string | null;
    lastRequestFailed: boolean;
}

export type StreamAction =
    | { type: 'SET_LOADING'; loading: boolean }
    | { type: 'BEGIN'; messageId: string; thinking: boolean }
    | { type: 'STREAMING' }
    | { type: 'SET_THINKING'; thinking: boolean }
    | { type: 'PERSISTING' }
    | { type: 'COMPLETE'; failed: boolean }
    | { type: 'CLEAR_FAILURE' }
    | { type: 'RESET' };

export const INITIAL_STREAM_STATE: StreamState = {
    phase: 'idle',
    isThinking: false,
    activeUserMessageId: null,
    lastRequestFailed: false,
};

export function estimateOutputTokens(content: string, reasoning: string): number {
    const totalChars = content.length + reasoning.length;
    return totalChars > 0 ? Math.ceil(totalChars / 3.5) : 0;
}

export function areStatsEqual(left: ChatResponseStats | undefined, right: ChatResponseStats | undefined): boolean {
    if (!left && !right) return true;
    if (!left || !right) return false;
    return (
        left.outputTokens === right.outputTokens
        && left.seconds === right.seconds
        && left.tokensPerSecond === right.tokensPerSecond
        && left.ttfbSeconds === right.ttfbSeconds
        && left.inputTokens === right.inputTokens
        && left.totalTokens === right.totalTokens
        && left.source === right.source
    );
}

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
    switch (action.type) {
        case 'SET_LOADING':
            if (action.loading) {
                return state.phase === 'idle'
                    ? { ...state, phase: 'preparing', isThinking: false, activeUserMessageId: null, lastRequestFailed: false }
                    : state;
            }
            return { ...state, phase: 'idle', isThinking: false, activeUserMessageId: null };
        case 'BEGIN':
            return { ...state, phase: 'requesting', activeUserMessageId: action.messageId, isThinking: action.thinking, lastRequestFailed: false };
        case 'STREAMING':
            return state.phase === 'idle' ? state : { ...state, phase: 'streaming' };
        case 'SET_THINKING':
            return { ...state, isThinking: action.thinking };
        case 'PERSISTING':
            return state.phase === 'idle' ? state : { ...state, phase: 'persisting' };
        case 'COMPLETE':
            return { ...state, phase: 'idle', isThinking: false, activeUserMessageId: null, lastRequestFailed: action.failed };
        case 'CLEAR_FAILURE':
            return state.lastRequestFailed ? { ...state, lastRequestFailed: false } : state;
        case 'RESET':
            return INITIAL_STREAM_STATE;
    }
}
