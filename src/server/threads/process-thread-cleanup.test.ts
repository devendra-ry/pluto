import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/shared/lib/supabase/database.types';
import { processThreadCleanup, type CleanupClaim } from './process-thread-cleanup';

const claim: CleanupClaim = { job_id: 'job', thread_id: 'thread', claim_token: 'lease', paths: ['owner/source/file.png'] };
function client(options: { storageError?: boolean; skipPaths?: boolean; finish?: boolean } = {}) {
    const calls: string[] = [];
    const fake = {
        storage: { from: () => ({ remove: async (paths: string[]) => {
            calls.push(`remove:${paths.length}`);
            return { data: options.skipPaths ? [] : paths.map(name => ({ name })), error: options.storageError ? new Error('storage') : null };
        } }) },
        rpc: async (name: string, args: { p_claim_token: string }) => {
            calls.push(name);
            assert.equal(args.p_claim_token, claim.claim_token);
            return { data: options.finish ?? true, error: null };
        },
    };
    return { supabase: fake as unknown as SupabaseClient<Database>, calls };
}

test('cleanup removes shared source objects before fenced completion, deduplicating paths', async () => {
    const fake = client();
    assert.equal(await processThreadCleanup(fake.supabase, 'attachments', 'owner', { ...claim, paths: [...claim.paths, ...claim.paths] }), true);
    assert.deepEqual(fake.calls, ['remove:1', 'finish_thread_cleanup_job']);
});

test('storage failures or silent policy denials retain a retryable job and never finish deletion', async () => {
    for (const options of [{ storageError: true }, { skipPaths: true }]) {
        const fake = client(options);
        assert.equal(await processThreadCleanup(fake.supabase, 'attachments', 'owner', claim), false);
        assert.deepEqual(fake.calls, ['remove:1', 'fail_thread_cleanup_job']);
    }
});

test('foreign paths never reach storage and empty claims still complete', async () => {
    const denied = client();
    assert.equal(await processThreadCleanup(denied.supabase, 'attachments', 'owner', { ...claim, paths: ['other/thread/file.png'] }), false);
    assert.deepEqual(denied.calls, ['fail_thread_cleanup_job']);
    const empty = client();
    assert.equal(await processThreadCleanup(empty.supabase, 'attachments', 'owner', { ...claim, paths: [] }), true);
    assert.deepEqual(empty.calls, ['finish_thread_cleanup_job']);
});

test('stale completion cannot report success after storage removal', async () => {
    const fake = client({ finish: false });
    assert.equal(await processThreadCleanup(fake.supabase, 'attachments', 'owner', claim), false);
});
