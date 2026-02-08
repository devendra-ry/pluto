// Available models from Chutes API
export const AVAILABLE_MODELS = [
    {
        id: 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE',
        name: 'DeepSeek V3.2 Speciale',
        description: 'Latest DeepSeek with TEE',
        supportsReasoning: true,
    },
    {
        id: 'deepseek-ai/DeepSeek-V3.2-TEE',
        name: 'DeepSeek V3.2',
        description: 'DeepSeek V3.2 with TEE (Non-Thinking)',
        supportsReasoning: false,
    },
    {
        id: 'deepseek-ai/DeepSeek-V3.2-TEE-THINKING',
        name: 'DeepSeek V3.2 Thinking',
        description: 'DeepSeek V3.2 with TEE (Thinking model)',
        supportsReasoning: true,
    },
    {
        id: 'openai/gpt-oss-120b-TEE',
        name: 'GPT-OSS 120B',
        description: 'Open source GPT 120B',
        supportsReasoning: true,
    },
    {
        id: 'openai/gpt-oss-20b',
        name: 'GPT-OSS 20B',
        description: 'Open source GPT 20B',
        supportsReasoning: true,
    },
    {
        id: 'moonshotai/Kimi-K2.5-TEE',
        name: 'Kimi K2.5',
        description: 'Moonshot AI latest model',
        supportsReasoning: true,
    },
    {
        id: 'MiniMaxAI/MiniMax-M2.1-TEE',
        name: 'MiniMax M2.1',
        description: 'MiniMax flagship model',
        supportsReasoning: true,
    },
    {
        id: 'zai-org/GLM-4.7-TEE',
        name: 'GLM 4.7 TEE',
        description: 'GLM with TEE security',
        supportsReasoning: true,
    },
    {
        id: 'zai-org/GLM-4.7-FP8',
        name: 'GLM 4.7 FP8',
        description: 'GLM optimized FP8',
        supportsReasoning: true,
    },
    {
        id: 'zai-org/GLM-4.7-Flash',
        name: 'GLM 4.7 Flash',
        description: 'Fast GLM model',
        supportsReasoning: true,
    },
    {
        id: 'Qwen/Qwen3-Coder-Next',
        name: 'Qwen 3 Coder Next',
        description: 'Advanced coding model (Thinking)',
        supportsReasoning: true,
    },
    {
        id: 'moonshotai/Kimi-K2-Instruct-0905',
        name: 'Kimi K2 Instruct',
        description: 'Kimi instruct model (Non-Thinking)',
        supportsReasoning: false,
    },
] as const;

export const DEFAULT_MODEL = 'moonshotai/Kimi-K2.5-TEE';

export type ModelId = typeof AVAILABLE_MODELS[number]['id'];
