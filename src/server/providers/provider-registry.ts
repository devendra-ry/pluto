import type { ModelConfig } from '@/shared/core/constants';
import { chutesProvider } from '@/server/providers/chutes-provider';
import { googleProvider } from '@/server/providers/google-provider';
import { ollamaProvider } from '@/server/providers/ollama-provider';
import { openRouterProvider } from '@/server/providers/openrouter-provider';
import type { ChatProvider } from '@/server/providers/provider-types';

const PROVIDERS: Record<'google' | 'openrouter' | 'chutes' | 'ollama', ChatProvider> = {
    google: googleProvider,
    openrouter: openRouterProvider,
    chutes: chutesProvider,
    ollama: ollamaProvider,
};

function resolveProviderId(modelConfig: ModelConfig): keyof typeof PROVIDERS {
    if (modelConfig.provider === 'google') return 'google';
    if (modelConfig.provider === 'openrouter') return 'openrouter';
    if (modelConfig.provider === 'ollama') return 'ollama';
    return 'chutes';
}

export function resolveChatProvider(modelConfig: ModelConfig): ChatProvider {
    return PROVIDERS[resolveProviderId(modelConfig)];
}
