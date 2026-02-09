'use client';

import { Minimax, Qwen, Zhipu, NousResearch, Gemini, OpenRouter } from '@lobehub/icons';
import { useState, useEffect, useMemo } from 'react';
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

// DeepSeek - Official logo
function DeepSeekLogo({ className, ...props }: { className?: string } & React.SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} className={className} style={{ flex: "none", lineHeight: "1" }} viewBox="0 0 24 24">
            <path
                fill="#4D6BFE"
                d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 0 1-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 0 0-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 0 1-.465.137 9.597 9.597 0 0 0-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 0 0 1.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 0 1 1.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 0 1 .415-.287.302.302 0 0 1 .2.288.306.306 0 0 1-.31.307.303.303 0 0 1-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 0 1-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 0 1 .016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 0 1-.254-.078.253.253 0 0 1-.114-.358c.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z"
            />
        </svg>
    );
}

// OpenAI - Official logo
function OpenAILogo({ className, ...props }: { className?: string } & React.SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} className={className} preserveAspectRatio="xMidYMid" viewBox="0 0 256 260">
            <path
                fill="currentColor"
                d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z"
            />
        </svg>
    );
}

// Moonshot/Kimi - Official logo
function MoonshotLogo({ className, ...props }: { className?: string } & React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            className={className}
            viewBox="0 0 512 512"
            fillRule="evenodd"
            clipRule="evenodd"
            strokeLinejoin="round"
            strokeMiterlimit="2"
        >
            <path d="M503 114.333v280c0 60.711-49.29 110-110 110H113c-60.711 0-110-49.289-110-110v-280c0-60.71 49.289-110 110-110h280c60.71 0 110 49.29 110 110z" fill="#000" />
            <path
                d="M342.065 189.759c1.886-2.42 3.541-4.63 5.289-6.77.81-1.007.74-1.771-.046-2.824-7.58-9.965-8.298-21.028-3.935-32.254 3.275-8.448 10.52-12.406 19.373-13.25 5.52-.521 10.936.046 15.959 2.73 6.596 3.53 10.438 8.912 11.688 16.341.995 5.926.81 11.712-.868 17.452-2.974 10.161-10.277 15.427-20.287 16.758-8.31 1.11-16.734 1.25-25.113 1.817-.648.046-1.308 0-2.06 0z"
                fill="#027aff"
            />
            <path
                d="M321.512 144.254h-50.064l-39.637 90.384h-56.036v-89.99H131v232.868h44.787v-98.103h78.973c13.598 0 26.015-7.927 31.744-20.252v118.355h44.787v-98.103c0-23.342-18.239-42.97-41.523-44.671v-.116h-24.593a45.577 45.577 0 0026.884-24.534l29.453-65.838z"
                fill="#fff"
            />
        </svg>
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

export function ModelSelector({ currentModel, onModelChange }: ModelSelectorProps) {
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
                    <div className="w-[52px] bg-[#14101a] border-r border-[#2a2535]/50 flex flex-col items-center py-3 gap-2">
                        <button
                            onClick={() => setSelectedProvider('all')}
                            className={cn(
                                'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                                selectedProvider === 'all' ? 'bg-[#2a2535] text-purple-400' : 'text-zinc-600 hover:text-zinc-400 hover:bg-[#1a1520]'
                            )}
                            title="All Models"
                        >
                            <Sparkles className={cn('h-5 w-5', selectedProvider === 'all' && 'fill-current')} />
                        </button>

                        <button
                            onClick={() => setSelectedProvider(null)}
                            className={cn(
                                'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                                selectedProvider === null ? 'bg-[#2a2535] text-yellow-500' : 'text-zinc-600 hover:text-zinc-400 hover:bg-[#1a1520]'
                            )}
                            title="Favorites"
                        >
                            <Star className={cn('h-5 w-5', selectedProvider === null && 'fill-current')} />
                        </button>

                        <div className="w-6 h-px bg-[#2a2535]/60 my-1" />

                        {PROVIDERS.map((provider) => {
                            const Logo = PROVIDER_LOGOS[provider.id];
                            const isActive = selectedProvider === provider.id;
                            return (
                                <button
                                    key={provider.id}
                                    onClick={() => setSelectedProvider(provider.id)}
                                    className={cn(
                                        'w-9 h-9 rounded-lg flex items-center justify-center transition-all relative',
                                        isActive ? 'bg-[#2a2535] text-white' : 'text-zinc-600 hover:text-zinc-400 hover:bg-[#1a1520]'
                                    )}
                                    title={provider.name}
                                >
                                    {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full" style={{ backgroundColor: provider.color }} />}
                                    {Logo && <Logo className="h-5 w-5" />}
                                </button>
                            );
                        })}
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
                                                            <div key={cap} className="h-6 w-6 rounded-full bg-[#2a2535]/80 flex items-center justify-center" title={CAPABILITY_INFO[cap].label}>
                                                                <Icon className="h-3 w-3 text-zinc-400" />
                                                            </div>
                                                        );
                                                    })}
                                                    <button className="h-6 w-6 rounded-full bg-[#2a2535]/80 flex items-center justify-center hover:bg-[#3a3545]" onClick={(e) => e.stopPropagation()}>
                                                        <Info className="h-3 w-3 text-zinc-500" />
                                                    </button>
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
}
