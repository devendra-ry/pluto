import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const scriptPath = resolve(import.meta.dirname, '../scripts/summarize-chat-performance.mjs');

function runSummary(input: string) {
    return execFileSync(process.execPath, [scriptPath], { input, encoding: 'utf8' });
}

test('summarizes terminal timings by model and excludes duplicate first-token and synthetic records', () => {
    const input = [
        'starting server',
        '{broken json',
        JSON.stringify({ msg: '[chat][perf] first provider token', model: 'model-a', providerFirstTokenMs: 10 }),
        JSON.stringify({ msg: '[chat][perf] stream completed', model: 'model-a', totalMs: 100, historyLoadMs: 20, responseCharacters: 42, prompt: 'PRIVATE_PROMPT', response: 'PRIVATE_RESPONSE' }),
        JSON.stringify({ msg: '[chat][perf] stream failed', model: 'model-a', totalMs: 300, historyLoadMs: 40 }),
        JSON.stringify({ msg: '[chat][perf] stream completed', model: 'model-a', totalMs: 500, historyLoadMs: 60, environment: 'test' }),
        JSON.stringify({ msg: 'other log', model: 'model-a' }),
    ].join('\n');

    const output = runSummary(input);
    assert.match(output, /Terminal requests: 2 \(completed 1, failed 1\)/);
    assert.match(output, /First-provider-token events: 1/);
    assert.match(output, /historyLoadMs\s+2\s+30\.0\s+39\.0/);
    assert.match(output, /totalMs\s+2\s+200\.0\s+290\.0/);
    assert.match(output, /Skipped synthetic records: 1/);
    assert.doesNotMatch(output, /PRIVATE_PROMPT|PRIVATE_RESPONSE|responseCharacters/);
});

test('prints an empty summary when stdin has no performance records', () => {
    const output = runSummary('not a performance record\n');
    assert.match(output, /No terminal performance records found\./);
    assert.match(output, /Ignored malformed or unrelated lines: 1/);
});
