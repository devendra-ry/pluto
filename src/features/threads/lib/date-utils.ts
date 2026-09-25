import {
    isToday,
    isYesterday,
    isThisWeek,
    isThisMonth,
} from 'date-fns';
import type { Thread } from '@/shared/contracts/thread';

export interface GroupedThreads {
    label: string;
    threads: Thread[];
}

// Group threads by date categories
export function groupThreadsByDate(threads: Thread[]): GroupedThreads[] {
    const order = ['Today', 'Yesterday', 'Previous 7 Days', 'This Month', 'Older'] as const;
    type GroupLabel = (typeof order)[number];
    const groups: Record<GroupLabel, Thread[]> = {
        Today: [],
        Yesterday: [],
        'Previous 7 Days': [],
        'This Month': [],
        Older: [],
    };

    for (const thread of threads) {
        const date = new Date(thread.updated_at);

        let label: GroupLabel;
        if (isToday(date)) {
            label = 'Today';
        } else if (isYesterday(date)) {
            label = 'Yesterday';
        } else if (isThisWeek(date)) {
            label = 'Previous 7 Days';
        } else if (isThisMonth(date)) {
            label = 'This Month';
        } else {
            label = 'Older';
        }
        groups[label].push(thread);
    }

    // Return only non-empty groups in order
    return order
        .filter((label) => groups[label].length > 0)
        .map((label) => ({ label, threads: groups[label] }));
}
