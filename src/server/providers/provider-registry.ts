import type { ModelConfig } from '@/shared/core/constants';
import { googleProvider } from '@/server/providers/google-provider';
import { openRouterProvider } from '@/server/providers/openrouter-provider';
import type { ChatProvider } from '@/server/providers/provider-types';

const PROVIDERS: Record<'google' | 'openrouter', ChatProvider> = {
    google: googleProvider,
    openrouter: openRouterProvider,
};

function resolveProviderId(modelConfig: ModelConfig): keyof typeof PROVIDERS {
    if (modelConfig.provider === 'google') return 'google';
    if (modelConfig.provider === 'openrouter') return 'openrouter';
    throw new Error(`Unsupported chat provider: ${modelConfig.provider}`);
}

export function resolveChatProvider(modelConfig: ModelConfig): ChatProvider {
    return PROVIDERS[resolveProviderId(modelConfig)];
}
