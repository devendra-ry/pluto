import {
    isToday,
    isYesterday,
    isThisWeek,
    isThisMonth,
    format,
} from 'date-fns';
import type { Thread } from '@/features/threads/hooks/use-threads';

export interface GroupedThreads {
    label: string;
    threads: Thread[];
}

// Group threads by date categories
export function groupThreadsByDate(threads: Thread[]): GroupedThreads[] {
    const groups: Record<string, Thread[]> = {
        Today: [],
        Yesterday: [],
        'Previous 7 Days': [],
        'This Month': [],
        Older: [],
    };

    for (const thread of threads) {
        const date = new Date(thread.updated_at);

        if (isToday(date)) {
            groups['Today'].push(thread);
        } else if (isYesterday(date)) {
            groups['Yesterday'].push(thread);
        } else if (isThisWeek(date)) {
            groups['Previous 7 Days'].push(thread);
        } else if (isThisMonth(date)) {
            groups['This Month'].push(thread);
        } else {
            groups['Older'].push(thread);
        }
    }

    // Return only non-empty groups in order
    const order = ['Today', 'Yesterday', 'Previous 7 Days', 'This Month', 'Older'];
    return order
        .filter((label) => groups[label].length > 0)
        .map((label) => ({ label, threads: groups[label] }));
}

// Format date for display
export function formatThreadDate(date: Date): string {
    if (isToday(date)) {
        return format(date, 'h:mm a');
    } else if (isYesterday(date)) {
        return 'Yesterday';
    } else if (isThisWeek(date)) {
        return format(date, 'EEEE');
    } else {
        return format(date, 'MMM d');
    }
}

