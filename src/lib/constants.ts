// Available models from Chutes API
export const AVAILABLE_MODELS = [
    {
        id: 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE',
        name: 'DeepSeek V3.2 Speciale',
        description: 'Latest DeepSeek with TEE',
    },
    {
        id: 'deepseek-ai/DeepSeek-V3.2-TEE',
        name: 'DeepSeek V3.2',
        description: 'DeepSeek V3.2 with TEE',
    },
    {
        id: 'openai/gpt-oss-120b-TEE',
        name: 'GPT-OSS 120B',
        description: 'Open source GPT 120B',
    },
    {
        id: 'openai/gpt-oss-20b',
        name: 'GPT-OSS 20B',
        description: 'Open source GPT 20B',
    },
    {
        id: 'moonshotai/Kimi-K2.5-TEE',
        name: 'Kimi K2.5',
        description: 'Moonshot AI latest model',
    },
    {
        id: 'MiniMaxAI/MiniMax-M2.1-TEE',
        name: 'MiniMax M2.1',
        description: 'MiniMax flagship model',
    },
    {
        id: 'zai-org/GLM-4.7-TEE',
        name: 'GLM 4.7 TEE',
        description: 'GLM with TEE security',
    },
    {
        id: 'zai-org/GLM-4.7-FP8',
        name: 'GLM 4.7 FP8',
        description: 'GLM optimized FP8',
    },
    {
        id: 'zai-org/GLM-4.7-Flash',
        name: 'GLM 4.7 Flash',
        description: 'Fast GLM model',
    },
] as const;

export const DEFAULT_MODEL = 'moonshotai/Kimi-K2.5-TEE';

export type ModelId = typeof AVAILABLE_MODELS[number]['id'];
