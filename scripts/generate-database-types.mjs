import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeDatabaseTypesAtomically } from './database-type-contracts.mjs';

const rootDirectory = resolve(import.meta.dirname, '..');
const envFile = resolve(rootDirectory, '.env.local');

try {
    await access(envFile);
    process.loadEnvFile(envFile);
} catch (error) {
    if (error?.code !== 'ENOENT') throw error;
}

function getProjectReference(urlValue) {
    if (!urlValue) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required to generate database types.');
    let url;
    try {
        url = new URL(urlValue);
    } catch {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL must be a valid Supabase project URL.');
    }
    const match = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/i);
    if (url.protocol !== 'https:' || !match) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL must use a 20-character Supabase project reference host.');
    }
    return match[1].toLowerCase();
}

function generateTypes(projectReference) {
    const args = [
        '--yes',
        'supabase@2.119.0',
        'gen',
        'types',
        'typescript',
        '--project-id',
        projectReference,
        '--schema',
        'public',
    ];
    const isWindows = process.platform === 'win32';
    const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npx';
    // The validated project reference is strictly alphanumeric; all other
    // command tokens are fixed. Invoking cmd.exe explicitly avoids Node's
    // deprecated shell:true argument concatenation path for npx.cmd.
    const commandArgs = isWindows ? ['/d', '/s', '/c', ['npx.cmd', ...args].join(' ')] : args;

    return new Promise((resolveGeneration, rejectGeneration) => {
        const child = spawn(command, commandArgs, {
            cwd: rootDirectory,
            env: process.env,
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 300_000,
        });
        const chunks = [];
        child.stdout.on('data', chunk => chunks.push(chunk));
        child.on('error', () => rejectGeneration(new Error('Could not start the pinned Supabase CLI.')));
        child.on('close', code => {
            if (code !== 0) {
                rejectGeneration(new Error(`Supabase type generation failed (exit ${code ?? 'unknown'}); existing types were preserved.`));
                return;
            }
            resolveGeneration(Buffer.concat(chunks).toString('utf8'));
        });
    });
}

const projectReference = getProjectReference(process.env.NEXT_PUBLIC_SUPABASE_URL);
const generatedSource = await generateTypes(projectReference);
const targetPath = resolve(rootDirectory, 'src/shared/lib/supabase/database.types.ts');
await writeDatabaseTypesAtomically(targetPath, generatedSource);
console.log(`Database TypeScript types updated atomically for project ${projectReference}.`);
