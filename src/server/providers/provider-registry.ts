import type { ModelConfig } from '@/shared/core/constants';
import { chutesProvider } from '@/server/providers/chutes-provider';
import { googleProvider } from '@/server/providers/google-provider';
import { openRouterProvider } from '@/server/providers/openrouter-provider';
import type { ChatProvider } from '@/server/providers/provider-types';

const PROVIDERS: Record<'google' | 'openrouter' | 'chutes', ChatProvider> = {
    google: googleProvider,
    openrouter: openRouterProvider,
    chutes: chutesProvider,
};

function resolveProviderId(modelConfig: ModelConfig): keyof typeof PROVIDERS {
    if (modelConfig.provider === 'google') return 'google';
    if (modelConfig.provider === 'openrouter') return 'openrouter';
    return 'chutes';
}

export function resolveChatProvider(modelConfig: ModelConfig): ChatProvider {
    return PROVIDERS[resolveProviderId(modelConfig)];
}


