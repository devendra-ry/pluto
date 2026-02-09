'use client';

import { Minimax, Qwen, Zhipu, NousResearch, Gemini, OpenRouter, OpenAI, Kimi, DeepSeek } from '@lobehub/icons';
import { useState, useEffect, useMemo, memo } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    ChevronDown,
    ChevronUp,
    Search,
    Filter,
    Star,
    Info,
    Zap,
    Eye,
    Brain,
    SlidersHorizontal,
    Wrench,
    ImagePlus,
    FileText,
    Folder,
    Check,
    Sparkles,
} from 'lucide-react';
import { AVAILABLE_MODELS, PROVIDERS, CAPABILITY_INFO, type Capability } from '@/lib/constants';
import { cn } from '@/lib/utils';

interface ModelSelectorProps {
    currentModel: string;
    onModelChange: (model: string) => void;
}

const CAPABILITY_ICONS: Record<Capability, React.ElementType> = {
    fast: Zap,
    vision: Eye,
    reasoning: Brain,
    effortControl: SlidersHorizontal,
    toolCalling: Wrench,
    imageGen: ImagePlus,
    pdf: FileText,
};

// ===== OFFICIAL PROVIDER LOGOS =====

// DeepSeek - Official logo from @lobehub/icons
function DeepSeekLogo({ className }: { className?: string }) {
    return (
        <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <DeepSeek.Color size={20} />
        </div>
    );
}

// OpenAI - Official logo from @lobehub/icons
function OpenAILogo({ className }: { className?: string }) {
    return (
        <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <OpenAI size={20} />
        </div>
    );
}

// Moonshot/Kimi - Official logo from @lobehub/icons
function MoonshotLogo({ className }: { className?: string }) {
    return (
        <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Kimi size={20} />
        </div>
    );
}

// MiniMax - Official logo from @lobehub/icons
function MiniMaxLogo({ className }: { className?: string }) {
    // Using the Minimax.Color component from @lobehub/icons
    // Note: This is a React component, not an SVG, so we render it directly
    return (
        <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Minimax.Color size={20} />
        </div>
    );
}

// Zhipu/GLM - Official logo from @lobehub/icons
function ZhipuLogo({ className }: { className?: string }) {
    // Using the Zhipu.Color component from @lobehub/icons
    return (
        <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zhipu.Color size={20} />
        </div>
    );
}

// Qwen/Alibaba - Official logo from @lobehub/icons
function QwenLogo({ className }: { className?: string }) {
    // Using the Qwen.Color component from @lobehub/icons
    return (
        <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Qwen.Color size={20} />
        </div>
    );
}

// Nous Research - Official logo from @lobehub/icons
function NousResearchLogo({ className }: { className?: string }) {
    return (
        <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <NousResearch size={20} />
        </div>
    );
}

// Google - Official logo from @lobehub/icons
function GoogleLogo({ className }: { className?: string }) {
    return (
        <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Gemini.Color size={20} />
        </div>
    );
}

// OpenRouter - Official logo from @lobehub/icons
function OpenRouterLogo({ className }: { className?: string }) {
    return (
        <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <OpenRouter size={20} />
        </div>
    );
}

// Provider icons mapping
const PROVIDER_LOGOS: Record<string, React.ComponentType<{ className?: string }>> = {
    'deepseek-ai': DeepSeekLogo,
    'openai': OpenAILogo,
    'moonshotai': MoonshotLogo,
    'MiniMaxAI': MiniMaxLogo,
    'zai-org': ZhipuLogo,
    'Qwen': QwenLogo,
    'NousResearch': NousResearchLogo,
    'google': GoogleLogo,
    'openrouter': OpenRouterLogo,
};

export const ModelSelector = memo(function ModelSelector({ currentModel, onModelChange }: ModelSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedProvider, setSelectedProvider] = useState<string | null>('all');
    const [activeFilters, setActiveFilters] = useState<Capability[]>([]);
    const [showLegacy, setShowLegacy] = useState(false);
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    const [starredModelIds, setStarredModelIds] = useState<string[]>([]);

    // Load favorites from local storage
    useEffect(() => {
        const saved = localStorage.getItem('starred-models');
        if (saved) {
            try {
                setStarredModelIds(JSON.parse(saved));
            } catch (e) {
                console.error('Failed to parse starred models', e);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Save favorites to local storage
    const toggleStarred = (e: React.MouseEvent, modelId: string) => {
        e.stopPropagation();
        const next = starredModelIds.includes(modelId)
            ? starredModelIds.filter(id => id !== modelId)
            : [...starredModelIds, modelId];
        setStarredModelIds(next);
        localStorage.setItem('starred-models', JSON.stringify(next));
    };

    const selectedModel = AVAILABLE_MODELS.find((m) => m.id === currentModel) ?? AVAILABLE_MODELS[0];

    const filteredModels = useMemo(() => {
        return AVAILABLE_MODELS.filter((model) => {
            // 1. Search Query (Always apply)
            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                if (!model.name.toLowerCase().includes(query) && !model.description.toLowerCase().includes(query)) return false;
            }

            // 2. Active Filters (Discovery Mode)
            // If filters are active, we show matching models from ALL providers
            // to make discovery easier for the user ("Search across all reasoning models")
            if (activeFilters.length > 0) {
                if (!activeFilters.every((cap) => model.capabilities.includes(cap))) return false;

                // Exception: Stay in Favorites if explicitly selected
                if (selectedProvider === null) {
                    if (!starredModelIds.includes(model.id)) return false;
                }

                if (model.isLegacy && !showLegacy) return false;
                return true;
            }

            // 3. Standard View (Provider or Favorites)
            if (selectedProvider === null) {
                if (!starredModelIds.includes(model.id)) return false;
            } else if (selectedProvider !== 'all') {
                if (model.provider !== selectedProvider) return false;
            }

            if (model.isLegacy && !showLegacy) return false;
            return true;
        });
    }, [searchQuery, selectedProvider, activeFilters, showLegacy, starredModelIds]);

    const legacyModels = AVAILABLE_MODELS.filter((m) => m.isLegacy);

    const toggleFilter = (cap: Capability) => {
        setActiveFilters((prev) => prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]);
    };

    const handleModelSelect = (modelId: string) => {
        onModelChange(modelId);
        setIsOpen(false);
    };

    return (
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 pl-0 pr-2 gap-2 text-zinc-100 hover:text-white hover:bg-transparent p-0 text-sm font-bold tracking-tight">
                    <span>{selectedModel.name}</span>
                    <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-[580px] h-[500px] p-0 bg-[#1a1520] border-[#2a2535]/80 shadow-2xl mb-2 overflow-hidden rounded-xl">
                <div className="flex h-full">
                    {/* Provider Sidebar */}
                    <div className="w-[52px] bg-[#14101a] border-r border-[#2a2535]/50 flex flex-col py-3 h-full">
                        {/* Fixed Top Actions */}
                        <div className="flex flex-col items-center gap-2 mb-1 shrink-0">
                            <div className="group/all relative flex flex-col items-center">
                                <button
                                    onClick={() => setSelectedProvider('all')}
                                    className={cn(
                                        'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                                        selectedProvider === 'all' ? 'bg-[#2a2535] text-purple-400' : 'text-zinc-600 hover:text-zinc-400 hover:bg-[#1a1520]'
                                    )}
                                >
                                    <Sparkles className={cn('h-5 w-5', selectedProvider === 'all' && 'fill-current')} />
                                </button>
                                <div className="absolute left-full ml-2 hidden group-hover/all:block z-50 pointer-events-none">
                                    <div className="bg-[#1a1520]/95 backdrop-blur-md text-[11px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/10 font-semibold tracking-tight animate-in fade-in slide-in-from-left-1 duration-200">
                                        <span className="text-[#fce7ef]">All Models</span>
                                    </div>
                                </div>
                            </div>

                            <div className="group/fav relative flex flex-col items-center">
                                <button
                                    onClick={() => setSelectedProvider(null)}
                                    className={cn(
                                        'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                                        selectedProvider === null ? 'bg-[#2a2535] text-yellow-500' : 'text-zinc-600 hover:text-zinc-400 hover:bg-[#1a1520]'
                                    )}
                                >
                                    <Star className={cn('h-5 w-5', selectedProvider === null && 'fill-current')} />
                                </button>
                                <div className="absolute left-full ml-2 hidden group-hover/fav:block z-50 pointer-events-none">
                                    <div className="bg-[#1a1520]/95 backdrop-blur-md text-[11px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/10 font-semibold tracking-tight animate-in fade-in slide-in-from-left-1 duration-200">
                                        <span className="text-[#fce7ef]">Favorites</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="w-6 h-px bg-[#2a2535]/60 my-2 shrink-0 self-center" />

                        {/* Scrollable Provider List */}
                        <div className="flex-1 w-full min-h-0 overflow-y-auto scrollbar-none">
                            <div className="flex flex-col items-center gap-2 pb-4">
                                {PROVIDERS.map((provider) => {
                                    const Logo = PROVIDER_LOGOS[provider.id];
                                    const isActive = selectedProvider === provider.id;
                                    return (
                                        <div key={provider.id} className="group/provider relative flex flex-col items-center">
                                            <button
                                                onClick={() => setSelectedProvider(provider.id)}
                                                className={cn(
                                                    'w-9 h-9 rounded-lg flex items-center justify-center transition-all relative',
                                                    isActive ? 'bg-[#2a2535] text-white' : 'text-zinc-600 hover:text-zinc-400 hover:bg-[#1a1520]'
                                                )}
                                            >
                                                {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full" style={{ backgroundColor: provider.color }} />}
                                                {Logo && <Logo className="h-5 w-5" />}
                                            </button>
                                            <div className="absolute left-full ml-2 hidden group-hover/provider:block z-50 pointer-events-none">
                                                <div className="bg-[#1a1520]/95 backdrop-blur-md text-[11px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/10 font-semibold tracking-tight animate-in fade-in slide-in-from-left-1 duration-200">
                                                    <span className="text-[#fce7ef]">{provider.name}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                        <div className="flex-none flex items-center gap-2 px-3 py-3 border-b border-[#2a2535]/50">
                            <Search className="h-4 w-4 text-zinc-500 shrink-0" />
                            <input
                                type="text"
                                placeholder="Search models..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="flex-1 bg-transparent text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
                            />
                            <DropdownMenu open={showFilterMenu} onOpenChange={setShowFilterMenu}>
                                <DropdownMenuTrigger asChild>
                                    <button className={cn('p-1.5 rounded-md transition-colors', activeFilters.length > 0 ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#2a2535]/50')}>
                                        <Filter className="h-4 w-4" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-52 bg-[#1a1520] border-[#2a2535]">
                                    {(Object.keys(CAPABILITY_INFO) as Capability[]).map((cap) => {
                                        const Icon = CAPABILITY_ICONS[cap];
                                        const isActive = activeFilters.includes(cap);
                                        return (
                                            <DropdownMenuItem key={cap} onClick={() => toggleFilter(cap)} className={cn('flex items-center gap-3 py-2 cursor-pointer', isActive && 'bg-purple-500/10')}>
                                                <Icon className={cn('h-4 w-4', isActive ? 'text-purple-400' : 'text-zinc-500')} />
                                                <span className={isActive ? 'text-purple-300' : 'text-zinc-300'}>{CAPABILITY_INFO[cap].label}</span>
                                                {isActive && <Check className="h-3 w-3 ml-auto text-purple-400" />}
                                            </DropdownMenuItem>
                                        );
                                    })}
                                    <div className="border-t border-[#2a2535] mt-1 pt-1">
                                        <DropdownMenuItem onClick={() => setActiveFilters([])} className="text-xs text-zinc-500 hover:text-zinc-300">Show combined results</DropdownMenuItem>
                                    </div>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        <ScrollArea className="flex-1 min-h-0">
                            <div className="py-1">
                                {filteredModels.length === 0 ? (
                                    <div className="px-4 py-8 text-center text-sm text-zinc-500">No models found</div>
                                ) : (
                                    filteredModels.map((model) => {
                                        const isSelected = model.id === currentModel;
                                        const ProviderLogo = PROVIDER_LOGOS[model.provider];
                                        return (
                                            <button
                                                key={model.id}
                                                onClick={() => handleModelSelect(model.id)}
                                                className={cn('w-full flex items-start gap-3 px-4 py-3 transition-colors text-left group', isSelected ? 'bg-[#2a2040]' : 'hover:bg-[#1f1a28]')}
                                            >
                                                {ProviderLogo ? (
                                                    <ProviderLogo className={cn('h-4 w-4 mt-1 shrink-0', isSelected ? 'text-purple-400' : 'text-zinc-500')} />
                                                ) : (
                                                    <Sparkles className={cn('h-4 w-4 mt-1 shrink-0', isSelected ? 'text-purple-400' : 'text-zinc-500')} />
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-semibold text-zinc-100 text-[15px]">{model.name}</span>
                                                        <button
                                                            onClick={(e) => toggleStarred(e, model.id)}
                                                            className="p-1 -m-1 hover:text-yellow-400 transition-colors"
                                                        >
                                                            <Star
                                                                className={cn(
                                                                    "h-4 w-4 transition-all",
                                                                    starredModelIds.includes(model.id)
                                                                        ? "text-yellow-500 fill-yellow-500"
                                                                        : "text-zinc-600 group-hover:text-zinc-500"
                                                                )}
                                                            />
                                                        </button>
                                                    </div>
                                                    <span className="text-[13px] text-zinc-500 block truncate mt-0.5">{model.description}</span>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                                                    {model.capabilities.slice(0, 3).map((cap) => {
                                                        const Icon = CAPABILITY_ICONS[cap];
                                                        return (
                                                            <div key={cap} className="group/cap relative flex flex-col items-center">
                                                                <div className="h-6 w-6 rounded-full bg-[#2a2535]/80 flex items-center justify-center">
                                                                    <Icon className="h-3 w-3 text-zinc-400" />
                                                                </div>
                                                                <div className="absolute bottom-full mb-2 hidden group-hover/cap:block z-50 pointer-events-none">
                                                                    <div className="bg-[#1a1520]/95 backdrop-blur-md text-[11px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/10 font-semibold tracking-tight animate-in fade-in zoom-in-95 duration-200">
                                                                        <span className="text-[#fce7ef]">{CAPABILITY_INFO[cap].label}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                    <div className="group/info relative flex flex-col items-center">
                                                        <button className="h-6 w-6 rounded-full bg-[#2a2535]/80 flex items-center justify-center hover:bg-[#3a3545]" onClick={(e) => e.stopPropagation()}>
                                                            <Info className="h-3 w-3 text-zinc-500" />
                                                        </button>
                                                        <div className="absolute bottom-full mb-2 hidden group-hover/info:block z-50 pointer-events-none">
                                                            <div className="bg-[#1a1520]/95 backdrop-blur-md text-[11px] px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-2xl border border-white/10 font-semibold tracking-tight animate-in fade-in zoom-in-95 duration-200">
                                                                <span className="text-[#fce7ef]">Model Information</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                                {legacyModels.length > 0 && (
                                    <div className="mt-2 border-t border-[#2a2535]/50">
                                        <button onClick={() => setShowLegacy(!showLegacy)} className="w-full flex items-center gap-2 px-4 py-3 text-sm text-zinc-500 hover:text-zinc-300 hover:bg-[#1f1a28] transition-colors">
                                            <Folder className="h-4 w-4" />
                                            <span>{legacyModels.length} legacy models</span>
                                            {showLegacy ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
});
