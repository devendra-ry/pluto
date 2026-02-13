'use client';

import { Minimax, Qwen, Zhipu, NousResearch, Gemini, OpenRouter, OpenAI, Kimi, DeepSeek } from '@lobehub/icons';
import { useState, useMemo, memo } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
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

// Provider icons mapping
// Added pointer-events-none to prevent default tooltips
const PROVIDER_LOGOS: Record<string, React.ComponentType<{ className?: string }>> = {
    'deepseek-ai': ({ className }) => <div className={cn(className, "pointer-events-none")}><DeepSeek.Color size={20} /></div>,
    'openai': ({ className }) => <div className={cn(className, "pointer-events-none")}><OpenAI size={20} /></div>,
    'moonshotai': ({ className }) => <div className={cn(className, "pointer-events-none")}><Kimi size={20} /></div>,
    'MiniMaxAI': ({ className }) => <div className={cn(className, "pointer-events-none")}><Minimax.Color size={20} /></div>,
    'zai-org': ({ className }) => <div className={cn(className, "pointer-events-none")}><Zhipu.Color size={20} /></div>,
    'Qwen': ({ className }) => <div className={cn(className, "pointer-events-none")}><Qwen.Color size={20} /></div>,
    'NousResearch': ({ className }) => <div className={cn(className, "pointer-events-none")}><NousResearch size={20} /></div>,
    'google': ({ className }) => <div className={cn(className, "pointer-events-none")}><Gemini.Color size={20} /></div>,
    'openrouter': ({ className }) => <div className={cn(className, "pointer-events-none")}><OpenRouter size={20} /></div>,
};

export const ModelSelector = memo(function ModelSelector({ currentModel, onModelChange }: ModelSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedProvider, setSelectedProvider] = useState<string | null>('all');
    const [activeFilters, setActiveFilters] = useState<Capability[]>([]);
    const [showLegacy, setShowLegacy] = useState(false);
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    const [starredModelIds, setStarredModelIds] = useState<string[]>(() => {
        if (typeof window === 'undefined') return [];
        const saved = window.localStorage.getItem('starred-models');
        if (!saved) return [];

        try {
            const parsed: unknown = JSON.parse(saved);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter((item): item is string => typeof item === 'string');
        } catch (error) {
            console.error('Failed to parse starred models', error);
            return [];
        }
    });

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
            if (model.hidden) return false;

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

    const legacyModels = AVAILABLE_MODELS.filter((m) => m.isLegacy && !m.hidden);

    const toggleFilter = (cap: Capability) => {
        setActiveFilters((prev) => prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]);
    };

    const handleModelSelect = (modelId: string) => {
        onModelChange(modelId);
        setIsOpen(false);
    };

    return (
        <TooltipProvider>
            <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 md:h-9 px-2 md:px-3 gap-2 text-zinc-100 hover:text-white hover:bg-white/5 transition-all text-sm font-semibold tracking-tight max-w-[120px] md:max-w-[200px] rounded-xl">
                        <span className="truncate">{selectedModel.name}</span>
                        <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    side="top"
                    sideOffset={12}
                    collisionPadding={20}
                    className="w-[calc(100vw-32px)] md:w-[580px] h-[80vh] md:h-[500px] p-0 bg-[#1a1520] border-[#2a2535]/80 shadow-2xl mb-2 rounded-xl overflow-hidden"
                >

                    <div className="flex h-full">
                        {/* Provider Sidebar */}
                        <div className="w-[52px] bg-[#14101a] border-r border-[#2a2535]/50 flex flex-col py-3 h-full rounded-l-xl">
                            {/* Fixed Top Actions */}
                            <div className="flex flex-col items-center gap-2 mb-1 shrink-0">
                                <Tooltip delayDuration={0}>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={() => setSelectedProvider('all')}
                                            className={cn(
                                                'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                                                selectedProvider === 'all' ? 'bg-[#2a2535] text-purple-400' : 'text-zinc-600 hover:text-zinc-400 hover:bg-[#1a1520]'
                                            )}
                                        >
                                            <Sparkles className={cn('h-5 w-5', selectedProvider === 'all' && 'fill-current')} />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">All Models</TooltipContent>
                                </Tooltip>

                                <Tooltip delayDuration={0}>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={() => setSelectedProvider(null)}
                                            className={cn(
                                                'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                                                selectedProvider === null ? 'bg-[#2a2535] text-yellow-500' : 'text-zinc-600 hover:text-zinc-400 hover:bg-[#1a1520]'
                                            )}
                                        >
                                            <Star className={cn('h-5 w-5', selectedProvider === null && 'fill-current')} />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">Favorites</TooltipContent>
                                </Tooltip>
                            </div>

                            <div className="w-6 h-px bg-[#2a2535]/60 my-2 shrink-0 self-center" />

                            {/* Scrollable Provider List */}
                            <div className="flex-1 w-full min-h-0 overflow-y-auto scrollbar-none">
                                <div className="flex flex-col items-center gap-2 pb-4">
                                    {PROVIDERS.map((provider) => {
                                        const Logo = PROVIDER_LOGOS[provider.id];
                                        const isActive = selectedProvider === provider.id;
                                        return (
                                            <Tooltip key={provider.id} delayDuration={0}>
                                                <TooltipTrigger asChild>
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
                                                </TooltipTrigger>
                                                <TooltipContent side="left">{provider.name}</TooltipContent>
                                            </Tooltip>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Main Content */}
                        <div className="flex-1 flex flex-col min-h-0 overflow-hidden rounded-r-xl">
                            <div className="flex-none flex items-center gap-2 px-3 py-3 border-b border-[#2a2535]/50">
                                <Search className="h-5 w-5 text-zinc-500 shrink-0" />
                                <input
                                    type="text"
                                    placeholder="Search models..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="flex-1 bg-transparent text-base text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
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
                                            <DropdownMenuItem onClick={() => setActiveFilters([])} className="text-sm text-zinc-500 hover:text-zinc-300">Show combined results</DropdownMenuItem>
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
                                                <div
                                                    key={model.id}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => handleModelSelect(model.id)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            handleModelSelect(model.id);
                                                        }
                                                    }}
                                                    className={cn('w-full flex items-start gap-2 md:gap-3 px-3 md:px-4 py-3 transition-colors text-left group cursor-pointer outline-none focus-visible:bg-[#2a2040]', isSelected ? 'bg-[#2a2040]' : 'hover:bg-[#1f1a28]')}

                                                >
                                                    {ProviderLogo ? (
                                                        <ProviderLogo className={cn('h-4 w-4 mt-1 shrink-0', isSelected ? 'text-purple-400' : 'text-zinc-500')} />
                                                    ) : (
                                                        <Sparkles className={cn('h-4 w-4 mt-1 shrink-0 pointer-events-none', isSelected ? 'text-purple-400' : 'text-zinc-500')} />
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className="font-semibold text-zinc-100 text-base truncate">{model.name}</span>

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
                                                        <span className="text-sm text-zinc-500 block truncate mt-0.5">{model.description}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                                                        {model.capabilities.slice(0, 3).map((cap) => {
                                                            const Icon = CAPABILITY_ICONS[cap];
                                                            return (
                                                                <Tooltip key={cap} delayDuration={0}>
                                                                    <TooltipTrigger asChild>
                                                                        <div className="h-6 w-6 rounded-full bg-[#2a2535]/80 flex items-center justify-center group-hover:bg-[#3a3545] transition-colors">
                                                                            <Icon className="h-3 w-3 text-zinc-400" />
                                                                        </div>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="left">{CAPABILITY_INFO[cap].label}</TooltipContent>
                                                                </Tooltip>
                                                            );
                                                        })}
                                                        <Tooltip delayDuration={0}>
                                                            <TooltipTrigger asChild>
                                                                <button className="h-6 w-6 rounded-full bg-[#2a2535]/80 flex items-center justify-center hover:bg-[#3a3545]" onClick={(e) => e.stopPropagation()}>
                                                                    <Info className="h-3 w-3 text-zinc-500" />
                                                                </button>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="left">Model Information</TooltipContent>
                                                        </Tooltip>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                    {legacyModels.length > 0 && (
                                        <div className="mt-2 border-t border-[#2a2535]/50">
                                            <button onClick={() => setShowLegacy(!showLegacy)} className="w-full flex items-center gap-2 px-4 py-3 text-base text-zinc-500 hover:text-zinc-300 hover:bg-[#1f1a28] transition-colors">
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
                </DropdownMenuContent >
            </DropdownMenu>
        </TooltipProvider>
    );
});
