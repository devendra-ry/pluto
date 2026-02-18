// Available models from Chutes API

export type Capability = 'fast' | 'vision' | 'reasoning' | 'effortControl' | 'toolCalling' | 'imageGen' | 'pdf';

export interface ModelConfig {
    id: string;
    name: string;
    description: string;
    provider: string;
    supportsReasoning: boolean;
    usesThinkingParam?: boolean;
    capabilities: Capability[];
    isLegacy?: boolean;
    hidden?: boolean;
}

export interface Provider {
    id: string;
    name: string;
    color: string;
}

export const PROVIDERS: Provider[] = [
    { id: 'deepseek-ai', name: 'DeepSeek', color: '#4A90D9' },
    { id: 'openai', name: 'OpenAI', color: '#10A37F' },
    { id: 'moonshotai', name: 'Moonshot', color: '#FFB800' },
    { id: 'MiniMaxAI', name: 'MiniMax', color: '#FF6B6B' },
    { id: 'zai-org', name: 'ZAI', color: '#9B59B6' },
    { id: 'Qwen', name: 'Qwen', color: '#3498DB' },
    { id: 'NousResearch', name: 'Nous', color: '#FFFFFF' },
    { id: 'google', name: 'Google', color: '#4285F4' },
    { id: 'openrouter', name: 'OpenRouter', color: '#6563FF' },
];

export const CAPABILITY_INFO: Record<Capability, { label: string; icon: string }> = {
    fast: { label: 'Fast', icon: 'Zap' },
    vision: { label: 'Vision', icon: 'Eye' },
    reasoning: { label: 'Reasoning', icon: 'Brain' },
    effortControl: { label: 'Effort Control', icon: 'SlidersHorizontal' },
    toolCalling: { label: 'Tool Calling', icon: 'Wrench' },
    imageGen: { label: 'Image Generation', icon: 'ImagePlus' },
    pdf: { label: 'PDF Comprehension', icon: 'FileText' },
};

export const AVAILABLE_MODELS: ModelConfig[] = [
    {
        id: 'deepseek-ai/DeepSeek-V3.2-Speciale-TEE',
        name: 'DeepSeek V3.2 Speciale',
        description: 'Latest DeepSeek with TEE',
        provider: 'deepseek-ai',
        supportsReasoning: true,
        capabilities: ['reasoning'],
    },
    {
        id: 'deepseek-ai/DeepSeek-V3.2-TEE',
        name: 'DeepSeek V3.2',
        description: 'DeepSeek V3.2 with TEE (toggle thinking)',
        provider: 'deepseek-ai',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['reasoning', 'effortControl'],
    },
    {
        id: 'deepseek-ai/DeepSeek-R1-0528-TEE',
        name: 'DeepSeek R1 0528 TEE',
        description: 'DeepSeek R1 variant with TEE',
        provider: 'deepseek-ai',
        supportsReasoning: true,
        capabilities: ['reasoning'],
    },
    {
        id: 'deepseek-ai/DeepSeek-V3-0324-TEE',
        name: 'DeepSeek V3 0324 TEE',
        description: 'DeepSeek V3 variant with TEE',
        provider: 'deepseek-ai',
        supportsReasoning: false,
        capabilities: [],
    },
    {
        id: 'openai/gpt-oss-120b-TEE',
        name: 'GPT-OSS 120B',
        description: 'Open source GPT 120B (toggle thinking)',
        provider: 'openai',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['fast', 'reasoning', 'effortControl'],
    },
    {
        id: 'openai/gpt-oss-20b',
        name: 'GPT-OSS 20B',
        description: 'Open source GPT 20B (toggle thinking)',
        provider: 'openai',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['fast', 'reasoning', 'effortControl'],
    },
    {
        id: 'moonshotai/Kimi-K2.5-TEE',
        name: 'Kimi K2.5',
        description: 'Moonshot AI latest model (toggle thinking)',
        provider: 'moonshotai',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['reasoning', 'vision', 'effortControl'],
    },
    {
        id: 'MiniMaxAI/MiniMax-M2.1-TEE',
        name: 'MiniMax M2.1',
        description: 'MiniMax flagship model',
        provider: 'MiniMaxAI',
        supportsReasoning: true,
        capabilities: ['reasoning'],
    },
    {
        id: 'MiniMaxAI/MiniMax-M2.5-TEE',
        name: 'MiniMax M2.5',
        description: 'MiniMax latest flagship model',
        provider: 'MiniMaxAI',
        supportsReasoning: true,
        capabilities: ['reasoning'],
    },
    {
        id: 'zai-org/GLM-4.7-TEE',
        name: 'GLM 4.7 TEE',
        description: 'GLM with TEE security (toggle thinking)',
        provider: 'zai-org',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['reasoning', 'effortControl'],
    },
    {
        id: 'zai-org/GLM-4.7-FP8',
        name: 'GLM 4.7 FP8',
        description: 'GLM optimized FP8 (toggle thinking)',
        provider: 'zai-org',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['reasoning', 'effortControl'],
    },
    {
        id: 'zai-org/GLM-4.7-Flash',
        name: 'GLM 4.7 Flash',
        description: 'Fast GLM model (toggle thinking)',
        provider: 'zai-org',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['fast', 'reasoning', 'effortControl'],
    },
    {
        id: 'zai-org/GLM-5-TEE',
        name: 'GLM 5 TEE',
        description: 'Latest GLM 5 with TEE security (toggle thinking)',
        provider: 'zai-org',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['reasoning', 'effortControl'],
    },
    {
        id: 'Qwen/Qwen3-Coder-Next',
        name: 'Qwen 3 Coder Next',
        description: 'Advanced coding model (Thinking)',
        provider: 'Qwen',
        supportsReasoning: true,
        capabilities: ['reasoning', 'toolCalling'],
    },
    {
        id: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
        name: 'Qwen 3 VL 235B',
        description: 'Large vision language model (Instruct)',
        provider: 'Qwen',
        supportsReasoning: false,
        capabilities: ['vision', 'toolCalling'],
    },
    {
        id: 'Qwen/Qwen3-235B-A22B-Instruct-2507-TEE',
        name: 'Qwen 3 235B Instruct TEE',
        description: 'High-capacity instruct model with TEE security',
        provider: 'Qwen',
        supportsReasoning: false,
        capabilities: ['toolCalling'],
    },
    {
        id: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
        name: 'Qwen 3 235B Thinking',
        description: 'Advanced reasoning model (Thinking)',
        provider: 'Qwen',
        supportsReasoning: true,
        capabilities: ['reasoning', 'toolCalling'],
    },
    {
        id: 'Qwen/Qwen3-32B',
        name: 'Qwen 3 32B',
        description: 'Efficient medium-sized model (Thinking)',
        provider: 'Qwen',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['reasoning'],
    },
    {
        id: 'Qwen/Qwen3-Next-80B-A3B-Instruct',
        name: 'Qwen 3 Next 80B',
        description: 'Next-gen 80B instruct model',
        provider: 'Qwen',
        supportsReasoning: false,
        capabilities: ['fast', 'toolCalling'],
    },
    {
        id: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
        name: 'Qwen 3 30B Instruct',
        description: 'Medium-sized Qwen 3 instruct model',
        provider: 'Qwen',
        supportsReasoning: false,
        capabilities: ['toolCalling'],
    },
    {
        id: 'Qwen/Qwen3.5-397B-A17B-TEE',
        name: 'Qwen 3.5 397B A17B TEE',
        description: 'Qwen 3.5 large TEE model',
        provider: 'Qwen',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['reasoning', 'effortControl', 'toolCalling'],
    },
    {
        id: 'moonshotai/Kimi-K2-Thinking-TEE',
        name: 'Kimi K2 Thinking TEE',
        description: 'Kimi thinking model with TEE protection',
        provider: 'moonshotai',
        supportsReasoning: true,
        capabilities: ['reasoning'],
    },
    {
        id: 'NousResearch/Hermes-4.3-36B',
        name: 'Hermes 4.3 36B',
        description: 'Efficient and smart Hermes model',
        provider: 'NousResearch',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['fast', 'reasoning', 'effortControl', 'toolCalling'],
    },
    {
        id: 'NousResearch/Hermes-4-70B',
        name: 'Hermes 4 70B',
        description: 'Large-scale Hermes language model',
        provider: 'NousResearch',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['reasoning', 'effortControl', 'toolCalling'],
    },
    {
        id: 'NousResearch/Hermes-4-405B-FP8-TEE',
        name: 'Hermes 4 405B TEE',
        description: 'Flagship Hermes model with TEE protection',
        provider: 'NousResearch',
        supportsReasoning: true,
        usesThinkingParam: true,
        capabilities: ['reasoning', 'effortControl', 'toolCalling'],
    },
    {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        description: 'Google\'s latest reasoning model',
        provider: 'google',
        supportsReasoning: true,
        capabilities: ['reasoning', 'vision', 'fast'],
    },
    {
        id: 'stepfun/step-3.5-flash:free',
        name: 'Step 3.5 Flash (Free)',
        description: 'High-speed reasoning model from Stepfun',
        provider: 'openrouter',
        supportsReasoning: true,
        capabilities: ['reasoning'],
    },
    {
        id: 'arcee-ai/trinity-large-preview:free',
        name: 'Trinity Large Preview (Free)',
        description: 'Large-scale preview model from Arcee AI',
        provider: 'openrouter',
        supportsReasoning: false,
        capabilities: [],
    },
    {
        id: 'arcee-ai/trinity-mini:free',
        name: 'Trinity Mini (Free)',
        description: 'Lightweight efficient reasoning model from Arcee AI',
        provider: 'openrouter',
        supportsReasoning: true,
        capabilities: ['reasoning'],
    },
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Fast and capable multimodal reasoning model',
        provider: 'google',
        supportsReasoning: true,
        capabilities: ['reasoning', 'vision', 'toolCalling', 'fast'],
    },
    {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash Lite',
        description: 'Ultra-fast lightweight reasoning model',
        provider: 'google',
        supportsReasoning: true,
        capabilities: ['reasoning', 'vision', 'toolCalling', 'fast'],
    },
    {
        id: 'tngtech/DeepSeek-TNG-R1T2-Chimera',
        name: 'DeepSeek TNG-R1T2 Chimera',
        description: 'Advanced reasoning model (Chimera)',
        provider: 'deepseek-ai',
        supportsReasoning: true,
        capabilities: ['reasoning'],
    },
    {
        id: 'zai-org/GLM-4.6V',
        name: 'GLM 4.6V',
        description: 'Multimodal vision and reasoning model',
        provider: 'zai-org',
        supportsReasoning: true,
        capabilities: ['vision', 'reasoning', 'toolCalling'],
    },
    {
        id: 'gemma-3-27b-it',
        name: 'Gemma 3 27B IT',
        description: 'Google\'s latest open-source multimodal model',
        provider: 'google',
        supportsReasoning: false,
        capabilities: [],
    },
];

export const DEFAULT_MODEL = 'moonshotai/Kimi-K2.5-TEE';
export const DEFAULT_REASONING_EFFORT = 'high';
export const IMAGE_GENERATION_MODEL = 'zai-org/z-image-turbo';
export const VIDEO_GENERATION_MODEL = 'Qwen/WAN-2.2-I2V-14B-Fast';
export const PENDING_GENERATION_THREAD_KEY = 'pending-generation-thread-id';
export const PENDING_GENERATION_MODEL_KEY = 'pending-generation-model-id';
export const PENDING_GENERATION_SEARCH_KEY = 'pending-generation-search';
export const PENDING_SYSTEM_PROMPT_KEY = 'pending-system-prompt';
export const SEARCH_ENABLED_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const;

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
