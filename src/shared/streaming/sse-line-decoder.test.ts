import assert from 'node:assert/strict';
import test from 'node:test';

import { readSseDataLine, SseEventDecoder, SseLineDecoder } from './sse-line-decoder';

test('decodes lines split across UTF-8 byte chunks', () => {
    const bytes = new TextEncoder().encode('data: {"content":"héllo"}\r\n\r\n');
    const decoder = new SseLineDecoder({ label: 'test' });
    const lines = [
        ...decoder.push(bytes.slice(0, 20)),
        ...decoder.push(bytes.slice(20)),
        ...decoder.finish(),
    ];
    assert.deepEqual(lines, ['data: {"content":"héllo"}', '']);
    assert.equal(readSseDataLine(lines[0] ?? ''), '{"content":"héllo"}');
});

test('accepts SSE data fields with or without a space', () => {
    assert.equal(readSseDataLine('data:value'), 'value');
    assert.equal(readSseDataLine('data: value'), 'value');
    assert.equal(readSseDataLine('data:  value '), ' value ');
    assert.equal(readSseDataLine('event: message'), null);
    assert.equal(readSseDataLine(' data: value'), null);
});

test('decodes LF, CRLF, and bare CR line endings across chunk boundaries', () => {
    const decoder = new SseLineDecoder({ label: 'line-endings' });
    const encoder = new TextEncoder();
    assert.deepEqual(decoder.push(encoder.encode('first\r')), []);
    assert.deepEqual(decoder.push(encoder.encode('\nsecond\rthird\n')), ['first', 'second', 'third']);
    assert.deepEqual(decoder.finish(), []);
});

test('frames multiline SSE data and dispatches a final unterminated event', () => {
    const decoder = new SseEventDecoder({ label: 'events' });
    const encoder = new TextEncoder();
    const events = [
        ...decoder.push(encoder.encode(': keepalive\r\ndata: {"c":\r\ndata: "hello"}\r\n\r\n')),
        ...decoder.push(encoder.encode('data: [DONE]')),
        ...decoder.finish(),
    ];
    assert.deepEqual(events, [
        { data: '{"c":\n"hello"}' },
        { data: '[DONE]' },
    ]);
});

test('bounds incomplete SSE lines', () => {
    const decoder = new SseLineDecoder({ label: 'bounded', warnAtChars: 2, maxBufferChars: 4 });
    assert.throws(() => decoder.push(new TextEncoder().encode('12345')), /bounded SSE buffer overflow/);
});
