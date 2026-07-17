import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import Module from 'node:module';

// Mock server-only in the CommonJS require cache
const serverOnlyPath = resolve(process.cwd(), 'node_modules/server-only/index.js');
Module._cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    exports: {},
    loaded: true,
};

const loaderPath = pathToFileURL(resolve(process.cwd(), 'tests/loader.mjs')).href;
register(loaderPath, import.meta.url);
