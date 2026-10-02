import { describe, test } from 'node:test';
import assert from 'node:assert';

import { CHAT_HISTORY_SELECT_COLUMNS, mapChatHistoryRow } from './chat-history';

describe('chat provider history mapping', () => {
    test('selects only the persisted fields needed to build provider context', () => {
        assert.strictEqual(CHAT_HISTORY_SELECT_COLUMNS, 'id,thread_id,role,content,attachments');
        assert.ok(!CHAT_HISTORY_SELECT_COLUMNS.includes('reasoning'));
        assert.ok(!CHAT_HISTORY_SELECT_COLUMNS.includes('reply_stats'));
    });

    test('preserves valid attachment context while dropping malformed stored metadata', () => {
        const history = mapChatHistoryRow({
            id: 'message-1',
            thread_id: 'thread-1',
            role: 'user',
            content: 'Summarize this file',
            attachments: [
                { id: 'file-1', name: 'brief.txt', mimeType: 'text/plain', size: 12, path: 'user/thread/brief', url: '/api/attachments/brief' },
                { id: 'bad-file', name: 'missing-size.pdf', mimeType: 'application/pdf', path: 'user/thread/bad', url: '/api/attachments/bad' },
            ],
        });

        assert.deepStrictEqual(history, {
            id: 'message-1',
            thread_id: 'thread-1',
            role: 'user',
            content: 'Summarize this file',
            attachments: [{
                id: 'file-1',
                name: 'brief.txt',
                mimeType: 'text/plain',
                size: 12,
                path: 'user/thread/brief',
                url: '/api/attachments/brief',
            }],
        });
    });
});
