import models from './models.json' with { type: 'json' };

export type Capability = 'fast' | 'vision' | 'reasoning' | 'effortControl' | 'toolCalling' | 'pdf';

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
    { id: 'google', name: 'Google', color: '#4285F4' },
];

export const CAPABILITY_INFO: Record<Capability, { label: string; icon: string }> = {
    fast: { label: 'Fast', icon: 'Zap' },
    vision: { label: 'Vision', icon: 'Eye' },
    reasoning: { label: 'Reasoning', icon: 'Brain' },
    effortControl: { label: 'Effort Control', icon: 'SlidersHorizontal' },
    toolCalling: { label: 'Tool Calling', icon: 'Wrench' },
    pdf: { label: 'PDF Comprehension', icon: 'FileText' },
};

export const AVAILABLE_MODELS: ModelConfig[] = models as unknown as ModelConfig[];

export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_REASONING_EFFORT = 'high';
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
