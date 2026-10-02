import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const databaseUrl = process.env.PLUTO_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const target = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    || target.search || target.hash) {
    throw new Error('Database regressions require an isolated local database. Use PLUTO_TEST_DATABASE_URL with a loopback host.');
}

const files = (await readdir(resolve('supabase/tests'))).filter(file => file.endsWith('.sql')).sort();
if (!files.length) throw new Error('No database regression scripts found');
for (const file of files) {
    console.log(`Database regression: ${file}`);
    await new Promise((resolveTest, reject) => {
        const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', resolve('supabase/tests', file)], {
            env: { ...process.env, PGDATABASE: databaseUrl }, stdio: 'inherit',
        });
        child.on('error', () => reject(new Error('psql is required. Install the PostgreSQL client and start local Supabase.')));
        child.on('exit', code => code === 0 ? resolveTest() : reject(new Error(`Database regression failed: ${file}`)));
    });
}
await import('./test-database-concurrency.mjs');
