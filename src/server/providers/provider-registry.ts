import type { ModelConfig } from '@/shared/core/constants';
import { googleProvider } from '@/server/providers/google-provider';
import type { ChatProvider } from '@/server/providers/provider-types';

const PROVIDERS: Record<string, ChatProvider> = {
    google: googleProvider,
};

export function resolveChatProvider(modelConfig: ModelConfig): ChatProvider {
    const provider = PROVIDERS[modelConfig.provider];
    if (!provider) {
        throw new Error(`Unsupported chat provider: ${modelConfig.provider}`);
    }
    return provider;
}
