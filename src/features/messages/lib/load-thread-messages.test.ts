import assert from 'node:assert';
import { test } from 'node:test';

import { runInBatches } from './load-thread-messages';

test('runInBatches bounds concurrent writes and records failures without stopping later batches', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await runInBatches([0, 1, 2, 3, 4], 2, async (item) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        if (item === 1) throw new Error('write failed');
    });

    assert.equal(maxInFlight, 2);
    assert.equal(results.length, 5);
    assert.equal(results[1]?.status, 'rejected');
    assert.equal(results[4]?.status, 'fulfilled');
});
