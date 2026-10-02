import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';

// Exercise the actual optimized Turbopack worker, not an esbuild substitute.
const staticRoot = resolve('.next/static');
let bootstrap, chunks;
for (const name of await readdir(resolve(staticRoot, 'chunks'))) {
    if (!name.endsWith('.js')) continue;
    const code = await readFile(resolve(staticRoot, 'chunks', name), 'utf8');
    const match = code.match(/\.default\("(static\/chunks\/turbopack-worker-[^"]+)",\[(.*?)\]\)/);
    if (match) { bootstrap = match[1]; chunks = JSON.parse(`[${match[2]}]`); break; }
}
assert.ok(bootstrap && chunks, 'Build the application first; no compiled Markdown worker found');
const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    await page.context().route('http://markdown-build.test/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (!path.startsWith('/_next/static/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>Production worker check</body></html>' });
        const file = resolve(staticRoot, path.slice('/_next/static/'.length));
        assert.ok(file.startsWith(staticRoot + sep));
        return route.fulfill({ contentType: 'text/javascript', body: await readFile(file) });
    });
    await page.goto('http://markdown-build.test/');
    const result = await page.evaluate(({ bootstrap, chunks }) => new Promise((resolve, reject) => {
        const config = [chunks.map(chunk => '/_next/' + chunk).reverse(), '', '/_next/', '', ''];
        const worker = new Worker('/_next/' + bootstrap + '#params=' + encodeURIComponent(JSON.stringify(config)));
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('Compiled worker timed out')); }, 10_000);
        worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
        worker.onmessage = ({ data }) => {
            if (data.type === 'ready') {
                worker.postMessage({ id: 1, content: '**Production** &copy; &notin;\n\n$x^2$\n\n```js\nconst value = 42;\n```', isStreaming: false });
                return;
            }
            clearTimeout(timer); worker.terminate(); resolve(data);
        };
    }), { bootstrap, chunks });
    assert.equal(result.id, 1);
    assert.ok(result.tree && !result.error);
    const serialized = JSON.stringify(result.tree);
    assert.ok(serialized.includes('©') && serialized.includes('∉') && serialized.includes('katex') && serialized.includes('hljs-keyword'));
    console.log('Optimized Next.js worker: entities, Markdown, math, and highlighting passed in Chromium.');
} finally { await browser.close(); }
