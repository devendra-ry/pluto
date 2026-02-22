import { pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';

const ROOT_DIR = process.cwd();

export async function resolve(specifier, context, defaultResolve) {
    let nextSpecifier = specifier;

    // Handle server-only mock
    if (specifier === 'server-only') {
        const absolutePath = pathResolve(ROOT_DIR, 'tests/mocks/server-only.js');
        return {
            url: pathToFileURL(absolutePath).href,
            shortCircuit: true,
            format: 'module',
        };
    }

    // Handle @/ alias
    if (specifier.startsWith('@/')) {
        const relativePath = specifier.slice(2);
        const absolutePath = pathResolve(ROOT_DIR, 'src', relativePath);
        nextSpecifier = pathToFileURL(absolutePath).href;
    }

    try {
        return await defaultResolve(nextSpecifier, context);
    } catch (err) {
        if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ERR_UNSUPPORTED_DIR_IMPORT') {
            // Only try extensions for local imports (relative or alias-resolved)
            if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('@/') || specifier.startsWith('file://')) {
                const extensions = ['.ts', '.tsx', '.js', '/index.ts', '/index.tsx', '/index.js'];
                for (const ext of extensions) {
                    try {
                        const trySpecifier = nextSpecifier + ext;
                        return await defaultResolve(trySpecifier, context);
                    } catch {
                        continue;
                    }
                }
            }
        }
        throw err;
    }
}
