import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastProvider } from '@/components/ui/toast';
import { AssistantMessage } from './chat-message-assistant';

test('collapsed reasoning does not mount its Markdown tree while content stays visible', () => {
    const html = renderToStaticMarkup(createElement(ToastProvider, null,
        createElement(AssistantMessage, {
            id: 'assistant-1',
            content: 'Visible answer.',
            reasoning: 'Hidden reasoning sentinel.\n\n$$x^2$$\n\n```js\nconst answer = 42;\n```',
        })));
    assert.ok(html.includes('Visible answer.'));
    assert.ok(html.includes('Reasoning'));
    assert.ok(!html.includes('Hidden reasoning sentinel'));
    assert.ok(!html.includes('<span class="katex'));
    assert.ok(!html.includes('<span class="hljs'));
});
