export interface ChatActionLease<TScope> {
    scope: TScope;
    lifecycle: number;
    action: number;
}

/** Serializes page actions and invalidates their continuations when a chat changes. */
export class ChatActionGate<TScope> {
    private scope: TScope | undefined;
    private lifecycle = 0;
    private actionSequence = 0;
    private activeLease: ChatActionLease<TScope> | null = null;

    setScope(scope: TScope) {
        if (this.scope === scope) return;
        this.scope = scope;
        this.invalidate();
    }

    acquire(scope: TScope): ChatActionLease<TScope> | null {
        if (scope !== this.scope || this.activeLease) return null;
        const lease = {
            scope,
            lifecycle: this.lifecycle,
            action: ++this.actionSequence,
        };
        this.activeLease = lease;
        return lease;
    }

    isCurrent(lease: ChatActionLease<TScope>): boolean {
        return this.isValid(lease) && this.activeLease === lease;
    }

    /** Remains true after release so queued React state updates can still apply. */
    isValid(lease: ChatActionLease<TScope>): boolean {
        return lease.lifecycle === this.lifecycle && lease.scope === this.scope;
    }

    release(lease: ChatActionLease<TScope>) {
        if (this.activeLease === lease) this.activeLease = null;
    }

    invalidate() {
        this.lifecycle += 1;
        this.activeLease = null;
    }
}
