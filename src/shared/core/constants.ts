import models from './models.json' with { type: 'json' };
import { z } from 'zod';

const CapabilitySchema = z.enum(['fast', 'vision', 'reasoning', 'effortControl', 'toolCalling', 'pdf']);
export type Capability = z.infer<typeof CapabilitySchema>;

export const ModelConfigSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    provider: z.string().min(1),
    supportsReasoning: z.boolean(),
    usesThinkingParam: z.boolean().optional(),
    capabilities: z.array(CapabilitySchema),
    isLegacy: z.boolean().optional(),
    hidden: z.boolean().optional(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

const AvailableModelsSchema = z.tuple([ModelConfigSchema]).rest(ModelConfigSchema);

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

export const AVAILABLE_MODELS = AvailableModelsSchema.parse(models);

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

export type CategoryIconName = (typeof CATEGORIES)[number]['icon'];
