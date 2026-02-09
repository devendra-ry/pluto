// Available models from Chutes API
interface ModelConfig {
    id: string;
    name: string;
    description: string;
    supportsReasoning: boolean;
    usesThinkingParam?: boolean;
}

export const AVAILABLE_MODELS: ModelConfig[] = [
    {
        id: 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE',
        name: 'DeepSeek V3.2 Speciale',
        description: 'Latest DeepSeek with TEE',
        supportsReasoning: true,
    },
    {
        id: 'deepseek-ai/DeepSeek-V3.2-TEE',
        name: 'DeepSeek V3.2',
        description: 'DeepSeek V3.2 with TEE (toggle thinking)',
        supportsReasoning: true,
        usesThinkingParam: true,
    },
    {
        id: 'openai/gpt-oss-120b-TEE',
        name: 'GPT-OSS 120B',
        description: 'Open source GPT 120B (toggle thinking)',
        supportsReasoning: true,
        usesThinkingParam: true,
    },
    {
        id: 'openai/gpt-oss-20b',
        name: 'GPT-OSS 20B',
        description: 'Open source GPT 20B (toggle thinking)',
        supportsReasoning: true,
        usesThinkingParam: true,
    },
    {
        id: 'moonshotai/Kimi-K2.5-TEE',
        name: 'Kimi K2.5',
        description: 'Moonshot AI latest model (toggle thinking)',
        supportsReasoning: true,
        usesThinkingParam: true,
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
        description: 'GLM with TEE security (toggle thinking)',
        supportsReasoning: true,
        usesThinkingParam: true,
    },
    {
        id: 'zai-org/GLM-4.7-FP8',
        name: 'GLM 4.7 FP8',
        description: 'GLM optimized FP8 (toggle thinking)',
        supportsReasoning: true,
        usesThinkingParam: true,
    },
    {
        id: 'zai-org/GLM-4.7-Flash',
        name: 'GLM 4.7 Flash',
        description: 'Fast GLM model (toggle thinking)',
        supportsReasoning: true,
        usesThinkingParam: true,
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
];

export const DEFAULT_MODEL = 'moonshotai/Kimi-K2.5-TEE';

export type ModelId = string;

// Suggested prompts for new chat
export const SUGGESTED_PROMPTS = [
    "How does AI work?",
    "Are black holes real?",
    "How many Rs are in the word \"strawberry\"?",
    "What is the meaning of life?",
] as const;

// Category buttons with prompts
export const CATEGORIES = [
    { icon: 'Wand2', label: 'Create', prompt: 'Help me create something creative...' },
    { icon: 'BookOpen', label: 'Explore', prompt: 'I want to explore and learn about...' },
    { icon: 'Code', label: 'Code', prompt: 'Help me write code for...' },
    { icon: 'GraduationCap', label: 'Learn', prompt: 'Teach me about...' },
] as const;

