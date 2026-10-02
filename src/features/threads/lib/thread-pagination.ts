export interface ThreadCursor {
    updated_at: string;
    id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Build a cursor only from the final row returned by a descending page. */
export function threadCursorFromPage<T extends ThreadCursor>(rows: readonly T[]): ThreadCursor | null {
    const last = rows.at(-1);
    return last ? { updated_at: last.updated_at, id: last.id } : null;
}

/**
 * Return the PostgREST disjunction for rows older than a descending cursor.
 * Both values are validated before interpolation so cursor data can never add
 * PostgREST operators, commas, or parentheses to the filter expression.
 */
export function threadCursorPostgrestFilter(cursor: ThreadCursor): string | null {
    if (!isValidThreadCursor(cursor)) return null;
    return `updated_at.lt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.lt.${cursor.id})`;
}

export function isValidThreadCursor(value: ThreadCursor): boolean {
    return typeof value.updated_at === 'string'
        && TIMESTAMP_PATTERN.test(value.updated_at)
        && Number.isFinite(Date.parse(value.updated_at))
        && typeof value.id === 'string'
        && UUID_PATTERN.test(value.id);
}

/** Merge pages by primary key, preferring the newest fetched copy of a row. */
export function mergeThreadPages<T extends ThreadCursor>(existing: readonly T[], incoming: readonly T[]): T[] {
    const byId = new Map(existing.map((row) => [row.id, row]));
    for (const row of incoming) byId.set(row.id, row);
    return [...byId.values()].sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id)
    );
}

/** Apply the realtime events observed during a read over its possibly stale rows. */
export function reconcileThreadPage<T extends ThreadCursor>(
    rows: readonly T[],
    overrides: ReadonlyMap<string, T | null>,
): T[] {
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const [id, override] of overrides) {
        if (override === null) byId.delete(id);
        else byId.set(id, override);
    }
    return [...byId.values()].sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id)
    );
}
