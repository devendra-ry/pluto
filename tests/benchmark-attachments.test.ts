import { test } from 'node:test';
import assert from 'node:assert';
import { prepareMessageAttachments } from '@/lib/chat-attachments';
import type { ModelConfig } from '@/lib/constants';
import type { ChatMessage } from '@/lib/types';

// Mock Supabase
const mockSupabase = {
    storage: {
        from: (bucket: string) => ({
            download: async (path: string) => {
                // Simulate network latency and data transfer
                await new Promise(resolve => setTimeout(resolve, 50)); // 50ms latency
                const size = 1024 * 1024; // 1MB
                const buffer = new Uint8Array(size).fill(0);
                return {
                    data: {
                        arrayBuffer: async () => buffer.buffer
                    },
                    error: null
                };
            }
        })
    }
};

const mockModelConfig: ModelConfig = {
    id: 'test-model',
    provider: 'chutes',
    capabilities: ['vision', 'pdf'],
    supportsReasoning: false,
    maxContextTokens: 4096,
    maxOutputTokens: 1024,
    costPerMillionInputTokens: 0,
    costPerMillionOutputTokens: 0,
    usesThinkingParam: false,
    label: 'Test Model',
    description: 'Test Model'
};

const mockMessages: ChatMessage[] = [
    {
        role: 'user',
        content: 'Check this out',
        attachments: [
            {
                id: '1',
                name: 'image.png',
                mimeType: 'image/png',
                size: 1024 * 1024,
                path: 'user1/image.png',
                url: 'http://example.com/image.png'
            }
        ]
    }
];

test('prepareMessageAttachments performance benchmark', async (t) => {
    const start = performance.now();
    await prepareMessageAttachments(
        mockMessages,
        mockSupabase as any,
        'user1',
        mockModelConfig
    );
    const firstCallTime = performance.now() - start;
    console.log(`First call took ${firstCallTime.toFixed(2)}ms`);

    const start2 = performance.now();
    await prepareMessageAttachments(
        mockMessages,
        mockSupabase as any,
        'user1',
        mockModelConfig
    );
    const secondCallTime = performance.now() - start2;
    console.log(`Second call took ${secondCallTime.toFixed(2)}ms`);

    // assert.ok(secondCallTime < firstCallTime / 2, 'Second call should be significantly faster due to caching');
});
