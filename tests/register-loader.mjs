import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const loaderPath = pathToFileURL(resolve(process.cwd(), 'tests/loader.mjs')).href;
register(loaderPath, import.meta.url);
