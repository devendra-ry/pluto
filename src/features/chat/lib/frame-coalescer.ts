import { scheduleFrame } from '@/shared/lib/animation-frame';

type FrameScheduler = (callback: () => void) => void;

/** Schedules one flush per frame and lets synchronous completion invalidate it. */
export class FrameCoalescer {
    private isScheduled = false;
    private isClosed = false;
    private generation = 0;

    constructor(
        private readonly flush: () => void,
        private readonly schedule: FrameScheduler = scheduleFrame,
    ) {}

    request() {
        if (this.isClosed || this.isScheduled) return;

        this.isScheduled = true;
        const generation = ++this.generation;
        this.schedule(() => {
            if (this.isClosed || generation !== this.generation) return;
            this.isScheduled = false;
            this.flush();
        });
    }

    flushNow() {
        if (this.isClosed) return;

        // Invalidate a queued frame so it cannot publish a second, stale update.
        this.generation += 1;
        this.isScheduled = false;
        this.flush();
    }

    close() {
        this.isClosed = true;
        this.isScheduled = false;
        this.generation += 1;
    }
}
