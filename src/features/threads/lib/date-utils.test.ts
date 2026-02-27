import { test } from 'node:test';
import assert from 'node:assert';
import { format } from 'date-fns';
import { groupThreadsByDate, formatThreadDate } from './date-utils';
import type { Thread } from '@/features/threads/hooks/use-threads';

// Helper to create a partial Thread object cast to Thread
// We only need updated_at for the grouping logic.
const createThread = (id: string, updatedAt: string): Thread => ({
    id,
    title: `Thread ${id}`,
    model: 'gpt-4',
    created_at: updatedAt,
    updated_at: updatedAt,
    // Cast to unknown then Thread to satisfy the type checker
    // since we are omitting many required fields of Thread.
} as unknown as Thread);

test('groupThreadsByDate', async (t) => {
    // Set "Now" to Wednesday, October 11, 2023 12:00:00 UTC
    // Week (Sunday start): Oct 8 - Oct 14
    const NOW = new Date('2023-10-11T12:00:00Z').getTime();
    t.mock.timers.enable({ apis: ['Date'], now: NOW });

    await t.test('should return empty array for empty input', () => {
        const result = groupThreadsByDate([]);
        assert.deepStrictEqual(result, []);
    });

    await t.test('should group threads correctly', () => {
        const threads = [
            createThread('1', '2023-10-11T10:00:00Z'), // Today (Wednesday)
            createThread('2', '2023-10-10T15:00:00Z'), // Yesterday (Tuesday)
            createThread('3', '2023-10-08T09:00:00Z'), // This Week (Sunday) - Groups into "Previous 7 Days"
            createThread('4', '2023-10-05T12:00:00Z'), // Last Week but This Month (Thursday Oct 5) - Groups into "This Month"
            createThread('5', '2023-09-20T12:00:00Z'), // Last Month - Groups into "Older"
        ];

        const result = groupThreadsByDate(threads);

        assert.strictEqual(result.length, 5);

        // Verify "Today"
        assert.strictEqual(result[0].label, 'Today');
        assert.strictEqual(result[0].threads.length, 1);
        assert.strictEqual(result[0].threads[0].id, '1');

        // Verify "Yesterday"
        assert.strictEqual(result[1].label, 'Yesterday');
        assert.strictEqual(result[1].threads.length, 1);
        assert.strictEqual(result[1].threads[0].id, '2');

        // Verify "Previous 7 Days"
        // Note: The implementation uses `isThisWeek` which checks for the current *Calendar Week* (usually Sunday-Saturday),
        // not a rolling 7-day window. Sunday Oct 8 is in the same week as Wed Oct 11.
        assert.strictEqual(result[2].label, 'Previous 7 Days');
        assert.strictEqual(result[2].threads.length, 1);
        assert.strictEqual(result[2].threads[0].id, '3');

        // Verify "This Month"
        // Thursday Oct 5 is in the previous week, so it falls out of `isThisWeek`,
        // but it is in the same month, so it goes to "This Month".
        assert.strictEqual(result[3].label, 'This Month');
        assert.strictEqual(result[3].threads.length, 1);
        assert.strictEqual(result[3].threads[0].id, '4');

        // Verify "Older"
        // 2023-09-20 is previous month
        assert.strictEqual(result[4].label, 'Older');
        assert.strictEqual(result[4].threads.length, 1);
        assert.strictEqual(result[4].threads[0].id, '5');
    });

    await t.test('should omit empty groups', () => {
        const threads = [
            createThread('1', '2023-10-11T10:00:00Z'), // Today
            createThread('5', '2023-09-20T12:00:00Z'), // Older
        ];

        const result = groupThreadsByDate(threads);

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].label, 'Today');
        assert.strictEqual(result[1].label, 'Older');
    });

    await t.test('should handle "Previous 7 Days" boundary correctly (Calendar Week logic)', () => {
        // Implementation note: "Previous 7 Days" actually means "This Calendar Week" (excluding Today/Yesterday).
        // So a date from last week (e.g. Saturday Oct 7), even if within 7 days,
        // will NOT be in this group if the week starts on Sunday.

        const threads = [
             createThread('6', '2023-10-05T12:00:00Z'), // Thursday (Last Week) -> This Month
        ];

        const result = groupThreadsByDate(threads);

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].label, 'This Month');
    });

    await t.test('should group multiple threads in same category', () => {
        const threads = [
            createThread('1', '2023-10-11T10:00:00Z'), // Today
            createThread('2', '2023-10-11T11:00:00Z'), // Today
        ];

        const result = groupThreadsByDate(threads);

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].label, 'Today');
        assert.strictEqual(result[0].threads.length, 2);
        // Order is preserved from input
        assert.strictEqual(result[0].threads[0].id, '1');
        assert.strictEqual(result[0].threads[1].id, '2');
    });
});

test('formatThreadDate', async (t) => {
    // Set "Now" to Wednesday, October 11, 2023 12:00:00 UTC
    // Week (Sunday start): Oct 8 - Oct 14
    const NOW = new Date('2023-10-11T12:00:00Z').getTime();
    t.mock.timers.enable({ apis: ['Date'], now: NOW });

    await t.test('should format today as time', () => {
        // Today at 10:30 UTC
        const date = new Date('2023-10-11T10:30:00Z');
        const result = formatThreadDate(date);
        // Depending on local timezone, 10:30 UTC might be different.
        // We compare against what date-fns format outputs for the same date.
        const expected = format(date, 'h:mm a');
        assert.strictEqual(result, expected);
    });

    await t.test('should format yesterday as "Yesterday"', () => {
        // Yesterday at 12:00 UTC
        const date = new Date('2023-10-10T12:00:00Z');
        const result = formatThreadDate(date);
        assert.strictEqual(result, 'Yesterday');
    });

    await t.test('should format this week (not today/yesterday) as day name', () => {
        // Sunday at 12:00 UTC
        const date = new Date('2023-10-08T12:00:00Z');
        const result = formatThreadDate(date);
        // Should be "Sunday" if locale is EN
        const expected = format(date, 'EEEE');
        assert.strictEqual(result, expected);
    });

    await t.test('should format older dates as "MMM d"', () => {
        // Thursday last week
        const date = new Date('2023-10-05T12:00:00Z');
        const result = formatThreadDate(date);
        const expected = format(date, 'MMM d');
        assert.strictEqual(result, expected);
    });
});