import type { ModelConfig } from '@/lib/constants';
import { chutesProvider } from '@/lib/providers/chutes-provider';
import { googleProvider } from '@/lib/providers/google-provider';
import { openRouterProvider } from '@/lib/providers/openrouter-provider';
import type { ChatProvider } from '@/lib/providers/provider-types';

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

