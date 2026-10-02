type MockSession = { user: { id: string } } | null;
type AuthCallback = (event: string, session: MockSession) => void;

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

const callbacks = new Set<AuthCallback>();
let currentUserId: string | null = 'user-1';

window.authStateMock = {
    confirmServerUser: () => {},
    seedCacheSentinel: () => {},
    refreshCount: 0,
    setUser(userId) {
        currentUserId = userId;
        const session = userId ? { user: { id: userId } } : null;
        callbacks.forEach(callback => callback(userId ? 'SIGNED_IN' : 'SIGNED_OUT', session));
    },
};

export function createClient() {
    return {
        auth: {
            onAuthStateChange(callback: AuthCallback) {
                callbacks.add(callback);
                callback('INITIAL_SESSION', currentUserId ? { user: { id: currentUserId } } : null);
                return { data: { subscription: { unsubscribe: () => callbacks.delete(callback) } } };
            },
        },
    };
}
