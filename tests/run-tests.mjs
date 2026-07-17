import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');

async function findTests(directory) {
    const entries = await readdir(resolve(rootDir, directory), {
        recursive: true,
        withFileTypes: true,
    });

    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
        .map((entry) => relative(rootDir, resolve(entry.parentPath, entry.name)))
        .sort();
}

const testFiles = [
    ...await findTests('src'),
    ...await findTests('tests'),
];

if (testFiles.length === 0) {
    throw new Error('No test files were found.');
}

const child = spawn(
    process.execPath,
    [
        '--import',
        './tests/register-loader.mjs',
        '--import',
        'tsx',
        '--test',
        ...testFiles,
    ],
    {
        cwd: rootDir,
        stdio: 'inherit',
    },
);

child.on('error', (error) => {
    throw error;
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exitCode = code ?? 1;
});
