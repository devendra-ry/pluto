type WriteResult<T> =
    | { ok: true; revision: number; value: T }
    | { ok: false; revision: number; value: T; error: unknown };

/** Preserve server write order and roll back to the last confirmed value. */
export class SerialValueWriter<T> {
    private tail: Promise<void> = Promise.resolve();
    private revision = 0;
    private pending = 0;
    private confirmed: T;

    constructor(initialValue: T) {
        this.confirmed = initialValue;
    }

    synchronize(value: T): boolean {
        if (this.pending > 0) return false;
        this.confirmed = value;
        return true;
    }

    isLatest(revision: number): boolean {
        return revision === this.revision;
    }

    write(value: T, persist: (value: T) => Promise<void>): Promise<WriteResult<T>> {
        const revision = ++this.revision;
        this.pending += 1;
        const result = this.tail.then(async (): Promise<WriteResult<T>> => {
            try {
                await persist(value);
                this.confirmed = value;
                return { ok: true, revision, value };
            } catch (error) {
                return { ok: false, revision, value: this.confirmed, error };
            } finally {
                this.pending -= 1;
            }
        });
        // A failed write must not poison the queue or leave an unhandled rejection.
        this.tail = result.then(() => undefined);
        return result;
    }
}
