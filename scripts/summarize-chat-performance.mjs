#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const COMPLETED_MESSAGE = '[chat][perf] stream completed';
const FAILED_MESSAGE = '[chat][perf] stream failed';
const FIRST_TOKEN_MESSAGE = '[chat][perf] first provider token';

function isSyntheticRecord(record) {
    const environment = String(record.environment ?? record.env ?? '').toLowerCase();
    const source = String(record.source ?? '').toLowerCase();
    return record.synthetic === true
        || record.isSynthetic === true
        || record.testOnly === true
        || record.test === true
        || environment === 'test'
        || environment === 'synthetic'
        || source === 'test'
        || source === 'synthetic';
}

function percentile(sortedValues, percentile) {
    if (sortedValues.length === 0) return 0;
    const position = (sortedValues.length - 1) * percentile;
    const lowerIndex = Math.floor(position);
    const fraction = position - lowerIndex;
    const lower = sortedValues[lowerIndex];
    const upper = sortedValues[Math.min(lowerIndex + 1, sortedValues.length - 1)];
    return lower + (upper - lower) * fraction;
}

function formatMs(value) {
    return value.toFixed(1);
}

function summarize(lines) {
    const models = new Map();
    let malformedOrUnrelated = 0;
    let syntheticRecords = 0;
    let firstTokenEvents = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (!trimmed.startsWith('{')) {
            malformedOrUnrelated += 1;
            continue;
        }

        let record;
        try {
            record = JSON.parse(trimmed);
        } catch {
            malformedOrUnrelated += 1;
            continue;
        }
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            malformedOrUnrelated += 1;
            continue;
        }

        const message = record.msg;
        if (![COMPLETED_MESSAGE, FAILED_MESSAGE, FIRST_TOKEN_MESSAGE].includes(message)) {
            malformedOrUnrelated += 1;
            continue;
        }
        if (isSyntheticRecord(record)) {
            syntheticRecords += 1;
            continue;
        }
        if (message === FIRST_TOKEN_MESSAGE) {
            firstTokenEvents += 1;
            // The terminal record repeats accumulated stage timings. Keeping
            // samples only from terminal records avoids counting a request twice.
            continue;
        }

        const model = typeof record.model === 'string' && record.model.trim()
            ? record.model.replace(/[\r\n\t]/g, ' ').slice(0, 80)
            : 'unknown';
        let summary = models.get(model);
        if (!summary) {
            summary = { completed: 0, failed: 0, stages: new Map() };
            models.set(model, summary);
        }

        if (message === COMPLETED_MESSAGE) summary.completed += 1;
        else summary.failed += 1;

        for (const [name, value] of Object.entries(record)) {
            if (!name.endsWith('Ms') || typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
            const stage = summary.stages.get(name) ?? [];
            stage.push(value);
            summary.stages.set(name, stage);
        }
    }

    return { models, malformedOrUnrelated, syntheticRecords, firstTokenEvents };
}

function renderSummary(summary) {
    const { models, malformedOrUnrelated, syntheticRecords, firstTokenEvents } = summary;
    const terminalCount = [...models.values()].reduce((total, model) => total + model.completed + model.failed, 0);
    const lines = [
        'Chat performance log summary',
        `Terminal requests: ${terminalCount} (completed ${[...models.values()].reduce((sum, model) => sum + model.completed, 0)}, failed ${[...models.values()].reduce((sum, model) => sum + model.failed, 0)})`,
        `First-provider-token events: ${firstTokenEvents}`,
    ];

    if (models.size === 0) lines.push('No terminal performance records found.');
    for (const [modelName, model] of [...models.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push('', `${modelName} — completed ${model.completed}, failed ${model.failed}`);
        if (model.stages.size === 0) {
            lines.push('  No timing stages found.');
            continue;
        }
        lines.push('  Stage                         Count   p50 ms   p95 ms');
        for (const [stageName, values] of [...model.stages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            const sorted = [...values].sort((a, b) => a - b);
            lines.push(`  ${stageName.padEnd(29)} ${String(sorted.length).padStart(5)} ${formatMs(percentile(sorted, 0.5)).padStart(8)} ${formatMs(percentile(sorted, 0.95)).padStart(8)}`);
        }
    }

    lines.push('', `Skipped synthetic records: ${syntheticRecords}`);
    lines.push(`Ignored malformed or unrelated lines: ${malformedOrUnrelated}`);
    lines.push('Only timing fields and model IDs are shown; message content is never read for output.');
    return `${lines.join('\n')}\n`;
}

function printHelp() {
    process.stdout.write('Usage: node scripts/summarize-chat-performance.mjs [log-file]\n\nReads structured [chat][perf] JSON log lines from a file or stdin and prints per-model timing percentiles. Synthetic/test-marked records are excluded.\n');
}

async function main(args) {
    if (args.includes('--help') || args.includes('-h')) {
        printHelp();
        return;
    }
    if (args.length > 1) {
        process.stderr.write('Pass at most one log file. Use stdin when no file is provided.\n');
        process.exitCode = 2;
        return;
    }

    const input = args[0]
        ? await readFile(resolve(args[0]), 'utf8')
        : await new Promise((resolveInput, reject) => {
            let data = '';
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', chunk => { data += chunk; });
            process.stdin.on('end', () => resolveInput(data));
            process.stdin.on('error', reject);
        });
    process.stdout.write(renderSummary(summarize(input.split(/\r?\n/))));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main(process.argv.slice(2)).catch(error => {
        process.stderr.write(`Unable to summarize chat performance logs: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
