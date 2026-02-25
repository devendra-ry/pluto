// Available models from Chutes API
import models from './models.json' with { type: 'json' };

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

export interface ImageGenerationModel {
    id: string;
    name: string;
}

export const PROVIDERS: Provider[] = [
    { id: 'deepseek-ai', name: 'DeepSeek', color: '#4A90D9' },
    { id: 'openai', name: 'OpenAI', color: '#10A37F' },
    { id: 'moonshotai', name: 'Moonshot', color: '#FFB800' },
    { id: 'MiniMaxAI', name: 'MiniMax', color: '#FF6B6B' },
    { id: 'zai-org', name: 'ZAI', color: '#9B59B6' },
    { id: 'Qwen', name: 'Qwen', color: '#3498DB' },
    { id: 'XiaomiMiMo', name: 'Xiaomi MiMo', color: '#FF6900' },

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

export const AVAILABLE_MODELS: ModelConfig[] = models as unknown as ModelConfig[];

export const IMAGE_GENERATION_MODELS: readonly ImageGenerationModel[] = [
    { id: 'zai-org/z-image-turbo', name: 'Z-Image Turbo' },
    { id: 'tencent/hunyuan-image-3', name: 'Hunyuan Image 3.0' },
    { id: 'Qwen/Qwen-Image-2512', name: 'Qwen Image 2512' },
    { id: 'hidream/hidream', name: 'HiDream' },
] as const;

const IMAGE_GENERATION_MODEL_SET = new Set<string>(IMAGE_GENERATION_MODELS.map((model) => model.id));

export function isImageGenerationModel(modelId: string | null | undefined): boolean {
    if (!modelId) return false;
    return IMAGE_GENERATION_MODEL_SET.has(modelId);
}

export const DEFAULT_MODEL = 'moonshotai/Kimi-K2.5-TEE';
export const DEFAULT_REASONING_EFFORT = 'high';
export const IMAGE_GENERATION_MODEL = IMAGE_GENERATION_MODELS[0]?.id ?? 'zai-org/z-image-turbo';
export const VIDEO_GENERATION_MODEL = 'Qwen/WAN-2.2-I2V-14B-Fast';
export const SEARCH_ENABLED_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const;

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
