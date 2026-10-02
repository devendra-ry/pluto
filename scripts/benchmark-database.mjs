import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const databaseUrl = process.env.PLUTO_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
let target;
try {
    target = new URL(databaseUrl);
} catch {
    throw new Error('Database benchmarks require a valid local PostgreSQL URL.');
}

if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    || target.search || target.hash) {
    throw new Error('Database benchmarks require an isolated local database. Use PLUTO_TEST_DATABASE_URL with a loopback host.');
}

const benchmarkFile = resolve(import.meta.dirname, '..', 'supabase', 'benchmarks', 'database-hot-paths.sql');
await access(benchmarkFile);
console.log('Running rollback-only database hot-path benchmark. EXPLAIN ANALYZE includes fixture query execution time.');

await new Promise((resolveBenchmark, reject) => {
    const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', benchmarkFile], {
        env: {
            ...process.env,
            PGDATABASE: databaseUrl,
            PGCONNECT_TIMEOUT: '5',
            PGAPPNAME: 'pluto-database-hot-path-benchmark',
        },
        stdio: 'inherit',
        timeout: 150_000,
    });
    child.on('error', () => reject(new Error('psql is required. Install the PostgreSQL client and start local Supabase.')));
    child.on('exit', code => code === 0
        ? resolveBenchmark()
        : reject(new Error(`Database benchmark failed with exit code ${code ?? 'unknown'}.`)));
});
