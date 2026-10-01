import { test, describe } from 'node:test';
import assert from 'node:assert';

import { ChatActionGate } from './chat-action-gate';

describe('ChatActionGate', () => {
    test('allows one action at a time and releases the gate', () => {
        const gate = new ChatActionGate<string>();
        gate.setScope('chat-a');

        const first = gate.acquire('chat-a');
        assert.ok(first);
        assert.strictEqual(gate.acquire('chat-a'), null);
        assert.strictEqual(gate.isCurrent(first), true);

        gate.release(first);
        const second = gate.acquire('chat-a');
        assert.ok(second);
        assert.strictEqual(gate.isCurrent(first), false);
        assert.strictEqual(gate.isCurrent(second), true);
    });

    test('invalidates active continuations on navigation while preserving already queued updates only within their lifecycle', () => {
        const gate = new ChatActionGate<string>();
        gate.setScope('chat-a');
        const lease = gate.acquire('chat-a');
        assert.ok(lease);

        gate.release(lease);
        assert.strictEqual(gate.isValid(lease), true);
        gate.setScope('chat-b');

        assert.strictEqual(gate.isCurrent(lease), false);
        assert.strictEqual(gate.isValid(lease), false);
        assert.strictEqual(gate.acquire('chat-a'), null);
        assert.ok(gate.acquire('chat-b'));
    });

    test('invalidates active work when the owning component unmounts', () => {
        const gate = new ChatActionGate<string>();
        gate.setScope('chat-a');
        const lease = gate.acquire('chat-a');
        assert.ok(lease);

        gate.invalidate();

        assert.strictEqual(gate.isCurrent(lease), false);
        assert.strictEqual(gate.isValid(lease), false);
        assert.ok(gate.acquire('chat-a'));
    });
});
