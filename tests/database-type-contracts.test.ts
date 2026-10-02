import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { refineDatabaseTypeContracts, writeDatabaseTypesAtomically } from '../scripts/database-type-contracts.mjs';

const generatedSdkTypes = `
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = {
  public: {
    Functions: {
      start_chat_with_message: {
        Args: {
          p_attachments: Json
          p_content: string
          p_model: string
          p_reasoning_effort: string
          p_system_prompt: string
          p_thread_id?: string
        }
        Returns: { thread_id: string; user_message_id: string }[]
      }
      soft_delete_messages: {
        Args: { p_anchor_message_id?: string; p_message_ids: string[]; p_reason?: string }
        Returns: number
      }
      claim_pending_generation_job: {
        Args: { p_lease_seconds?: number; p_thread_id: string; p_user_message_id?: string }
        Returns: { claim_token: string; reasoning_effort: string; system_prompt: string }[]
      }
      attachment_path_thread_id: {
        Args: { p_path: string; p_user_id: string }
        Returns: string
      }
      unrelated_rpc: {
        Args: { p_reasoning_effort: string; p_thread_id?: string }
        Returns: string
      }
    }
  }
};
`;

async function cleanupTestDirectory(directory: string) {
    const resolvedDirectory = resolve(directory);
    const resolvedTempDirectory = resolve(tmpdir());
    assert.equal(dirname(resolvedDirectory), resolvedTempDirectory);
    assert.ok(basename(resolvedDirectory).startsWith('pluto-db-types-'));
    await rm(resolvedDirectory, { recursive: true, force: true });
}

test('refines nullable SQL RPC contracts while preserving unrelated generated arguments', () => {
    const refined = refineDatabaseTypeContracts(generatedSdkTypes);

    assert.match(refined, /p_reasoning_effort: string \| null/);
    assert.match(refined, /p_system_prompt: string \| null/);
    assert.match(refined, /p_thread_id\?: string \| null/);
    assert.match(refined, /p_anchor_message_id\?: string \| null/);
    assert.match(refined, /p_user_message_id\?: string \| null/);
    assert.match(refined, /reasoning_effort: string \| null/);
    assert.match(refined, /system_prompt: string \| null/);
    assert.match(refined, /attachment_path_thread_id:[\s\S]*?Returns: string \| null/);
    assert.match(refined, /unrelated_rpc:[\s\S]*?Args: \{ p_reasoning_effort: string; p_thread_id\?: string \}/);
    assert.equal(refineDatabaseTypeContracts(refined), refined);
});

test('rejects truncated generated output and missing nullable RPC definitions', () => {
    assert.throws(() => refineDatabaseTypeContracts(generatedSdkTypes.slice(0, -8)), /truncated|unbalanced/i);

    const missingFunction = generatedSdkTypes.replace(/      attachment_path_thread_id:[\s\S]*?\n      }\n/, '');
    assert.throws(() => refineDatabaseTypeContracts(missingFunction), /attachment_path_thread_id/);
});

test('invalid generator output leaves the existing types untouched and removes temporary files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pluto-db-types-'));
    const target = join(directory, 'database.types.ts');
    await writeFile(target, 'existing known-good types\n', 'utf8');

    try {
        await assert.rejects(writeDatabaseTypesAtomically(target, generatedSdkTypes.slice(0, -8)), /truncated|unbalanced/i);
        assert.equal(await readFile(target, 'utf8'), 'existing known-good types\n');
        assert.deepEqual(await readdir(directory), ['database.types.ts']);
    } finally {
        await cleanupTestDirectory(directory);
    }
});

test('valid generated output atomically updates the requested file with refined contracts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pluto-db-types-'));
    const target = join(directory, 'database.types.ts');
    try {
        await writeDatabaseTypesAtomically(target, generatedSdkTypes);
        const written = await readFile(target, 'utf8');
        assert.match(written, /p_user_message_id\?: string \| null/);
        assert.deepEqual(await readdir(directory), ['database.types.ts']);
    } finally {
        await cleanupTestDirectory(directory);
    }
});
