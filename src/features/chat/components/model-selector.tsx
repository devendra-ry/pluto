'use client';

import { useState, useMemo, useEffect, memo } from 'react';
import { ProviderIcon, type ProviderIconName } from './provider-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    FileText,
    Folder,
    Check,
    Sparkles,
} from 'lucide-react';
import { AVAILABLE_MODELS, PROVIDERS, CAPABILITY_INFO, type Capability } from '@/shared/core/constants';
import { cn } from '@/shared/core/utils';

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
    pdf: FileText,
};

// ===== OFFICIAL PROVIDER LOGOS =====

// Provider icons mapping
// Added pointer-events-none to prevent default tooltips
const PROVIDER_ICON_NAMES: Record<string, ProviderIconName> = {
    google: 'Gemini',
};

const PROVIDER_LOGOS: Record<string, React.ComponentType<{ className?: string }>> = Object.fromEntries(
    Object.entries(PROVIDER_ICON_NAMES).map(([provider, name]) => [
        provider,
        ({ className }: { className?: string }) => (
            <div className={cn(className, 'pointer-events-none')}><ProviderIcon name={name} /></div>
        ),
    ]),
);

export const ModelSelector = memo(function ModelSelector({ currentModel, onModelChange }: ModelSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedProvider, setSelectedProvider] = useState<string | null>('all');
    const [activeFilters, setActiveFilters] = useState<Capability[]>([]);
    const [showLegacy, setShowLegacy] = useState(false);
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    const [starredModelIds, setStarredModelIds] = useState<string[]>([]);
    // Storage may be unavailable in private or embedded browsers. Load after
    // hydration so server markup and the first client render also agree.
    useEffect(() => {
        try {
            const saved = window.localStorage.getItem('starred-models');
            if (!saved) return;
            const parsed: unknown = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                setStarredModelIds(parsed.filter((item): item is string =>
                    typeof item === 'string' && AVAILABLE_MODELS.some(model => model.id === item && !model.hidden)));
            }
        } catch {
            // Favorites still work for this session without persistent storage.
        }
    }, []);

    // Save favorites to local storage
    const toggleStarred = (e: React.MouseEvent, modelId: string) => {
        e.stopPropagation();
        const next = starredModelIds.includes(modelId)
            ? starredModelIds.filter(id => id !== modelId)
            : [...starredModelIds, modelId];
        setStarredModelIds(next);
        try { localStorage.setItem('starred-models', JSON.stringify(next)); } catch { /* Session-only favorites. */ }
    };

    const selectableModels = useMemo(
        () => AVAILABLE_MODELS.filter((model) => !model.hidden),
        []
    );
    const selectedModel = selectableModels.find((m) => m.id === currentModel) ?? selectableModels[0] ?? AVAILABLE_MODELS[0];

    const filteredModels = useMemo(() => {
        return AVAILABLE_MODELS.filter((model) => {
            if (model.hidden) return false;

            // 1. Search Query (Always apply)
            if (searchQuery.trim()) {
                const query = searchQuery.trim().toLowerCase();
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
                    <Button variant="ghost" aria-label={`Choose model: ${selectedModel.name}`} className="h-10 px-2 md:px-3 gap-2 text-foreground hover:text-white hover:bg-accent transition-colors text-sm font-semibold tracking-tight max-w-[96px] min-[380px]:max-w-[145px] md:max-w-[220px] rounded-xl">
                        <span className="truncate">{selectedModel.name}</span>
                        <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    side="top"
                    sideOffset={12}
                    collisionPadding={20}
                    className="w-[calc(100vw-32px)] md:w-[580px] h-[min(500px,80dvh)] md:h-[500px] p-0 bg-popover border-border shadow-2xl mb-2 rounded-xl overflow-hidden"
                >

                    <div className="flex h-full">
                        {/* Provider Sidebar */}
                        <div className="w-[52px] bg-background border-r border-border flex flex-col py-3 h-full rounded-l-xl">
                            {/* Fixed Top Actions */}
                            <div className="flex flex-col items-center gap-2 mb-1 shrink-0">
                                <Tooltip delayDuration={0}>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            aria-label="Show all models"
                                            onClick={() => setSelectedProvider('all')}
                                            className={cn(
                                                'w-9 h-9 rounded-lg flex items-center justify-center transition-[color,background-color,border-color,box-shadow,opacity,transform]',
                                                selectedProvider === 'all' ? 'bg-accent text-brand-400' : 'text-muted-foreground hover:text-foreground hover:bg-popover'
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
                                            type="button"
                                            aria-label="Show favorite models"
                                            onClick={() => setSelectedProvider(null)}
                                            className={cn(
                                                'w-9 h-9 rounded-lg flex items-center justify-center transition-[color,background-color,border-color,box-shadow,opacity,transform]',
                                                selectedProvider === null ? 'bg-accent text-warning' : 'text-muted-foreground hover:text-foreground hover:bg-popover'
                                            )}
                                        >
                                            <Star className={cn('h-5 w-5', selectedProvider === null && 'fill-current')} />
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">Favorites</TooltipContent>
                                </Tooltip>
                            </div>

                            <div className="w-6 h-px bg-accent my-2 shrink-0 self-center" />

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
                                                        type="button"
                                                        aria-label={`Show ${provider.name} models`}
                                                        onClick={() => setSelectedProvider(provider.id)}
                                                        className={cn(
                                                            'w-9 h-9 rounded-lg flex items-center justify-center transition-[color,background-color,border-color,box-shadow,opacity,transform] relative',
                                                            isActive ? 'bg-accent text-white' : 'text-muted-foreground hover:text-foreground hover:bg-popover'
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
                            <div className="flex-none flex items-center gap-2 px-3 py-3 border-b border-border">
                                <Search className="h-5 w-5 text-muted-foreground shrink-0" />
                                <Input
                                    type="text"
                                    aria-label="Search models"
                                    placeholder="Search models..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-base text-foreground shadow-none placeholder:text-muted-foreground focus-visible:outline-none"
                                />
                                <DropdownMenu open={showFilterMenu} onOpenChange={setShowFilterMenu}>
                                    <DropdownMenuTrigger asChild>
                                        <button type="button" aria-label="Filter models" className={cn('p-1.5 rounded-md transition-colors', activeFilters.length > 0 ? 'text-brand-400 bg-brand-500/10' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}>
                                            <Filter className="h-4 w-4" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-52 bg-popover border-border">
                                        {(Object.keys(CAPABILITY_INFO) as Capability[]).map((cap) => {
                                            const Icon = CAPABILITY_ICONS[cap];
                                            const isActive = activeFilters.includes(cap);
                                            return (
                                                <DropdownMenuItem key={cap} onClick={() => toggleFilter(cap)} className={cn('flex items-center gap-3 py-2 cursor-pointer', isActive && 'bg-brand-500/10')}>
                                                    <Icon className={cn('h-4 w-4', isActive ? 'text-brand-400' : 'text-muted-foreground')} />
                                                    <span className={isActive ? 'text-brand-300' : 'text-foreground'}>{CAPABILITY_INFO[cap].label}</span>
                                                    {isActive && <Check className="h-3 w-3 ml-auto text-brand-400" />}
                                                </DropdownMenuItem>
                                            );
                                        })}
                                        <div className="border-t border-border mt-1 pt-1">
                                            <DropdownMenuItem onClick={() => setActiveFilters([])} className="text-sm text-muted-foreground hover:text-foreground">Clear filters</DropdownMenuItem>
                                        </div>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>

                            <ScrollArea className="flex-1 min-h-0">
                                <div className="py-1">
                                    {filteredModels.length === 0 ? (
                                        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                                            <p className="font-medium text-foreground">{selectedProvider === null && !searchQuery && !activeFilters.length ? 'No favorite models yet' : 'No matching models'}</p>
                                            <p className="mt-2">{selectedProvider === null ? 'Use the star beside a model to keep it here.' : 'Try a different search or clear your filters.'}</p>
                                            <Button variant="outline" className="mt-4" onClick={() => { setSearchQuery(''); setActiveFilters([]); setSelectedProvider('all'); }}>Show all models</Button>
                                        </div>
                                    ) : (
                                        filteredModels.map((model) => {
                                            const isSelected = model.id === currentModel;
                                            const ProviderLogo = PROVIDER_LOGOS[model.provider];
                                            return (
                                                <div
                                                    key={model.id}
                                                    role="button"
                                                    aria-label={`Select ${model.name}${isSelected ? ', current model' : ''}`}
                                                    tabIndex={0}
                                                    onClick={() => handleModelSelect(model.id)}
                                                    onKeyDown={(e) => {
                                                        if (e.target !== e.currentTarget) return;
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            handleModelSelect(model.id);
                                                        }
                                                    }}
                                                    className={cn('w-full flex items-start gap-2 md:gap-3 px-3 md:px-4 py-3 transition-colors text-left group cursor-pointer outline-none focus-visible:bg-accent', isSelected ? 'bg-accent' : 'hover:bg-secondary')}

                                                >
                                                    {ProviderLogo ? (
                                                        <ProviderLogo className={cn('h-4 w-4 mt-1 shrink-0', isSelected ? 'text-brand-400' : 'text-muted-foreground')} />
                                                    ) : (
                                                        <Sparkles className={cn('h-4 w-4 mt-1 shrink-0 pointer-events-none', isSelected ? 'text-brand-400' : 'text-muted-foreground')} />
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className="font-semibold text-foreground text-base truncate">{model.name}</span>
                                                            {isSelected && <Check className="h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />}

                                                            <button
                                                                type="button"
                                                                aria-label={`${starredModelIds.includes(model.id) ? 'Remove' : 'Add'} ${model.name} ${starredModelIds.includes(model.id) ? 'from' : 'to'} favorites`}
                                                                aria-pressed={starredModelIds.includes(model.id)}
                                                                onClick={(e) => toggleStarred(e, model.id)}
                                                                className="p-1 -m-1 hover:text-warning transition-colors"
                                                            >
                                                                <Star
                                                                    className={cn(
                                                                        "h-4 w-4 transition-[color,background-color,border-color,box-shadow,opacity,transform]",
                                                                        starredModelIds.includes(model.id)
                                                                            ? "text-warning fill-warning"
                                                                            : "text-muted-foreground group-hover:text-foreground"
                                                                    )}
                                                                />
                                                            </button>
                                                        </div>
                                                        <span className="text-sm text-muted-foreground block truncate mt-0.5">{model.description}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                                                        {model.capabilities.slice(0, 3).map((cap) => {
                                                            const Icon = CAPABILITY_ICONS[cap];
                                                            return (
                                                                <Tooltip key={cap} delayDuration={0}>
                                                                    <TooltipTrigger asChild>
                                                                        <div className="h-6 w-6 rounded-full bg-accent flex items-center justify-center group-hover:bg-input transition-colors">
                                                                            <Icon className="h-3 w-3 text-muted-foreground" />
                                                                        </div>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="left">{CAPABILITY_INFO[cap].label}</TooltipContent>
                                                                </Tooltip>
                                                            );
                                                        })}
                                                        <Tooltip delayDuration={0}>
                                                            <TooltipTrigger asChild>
                                                                <button type="button" aria-label={`More information about ${model.name}`} className="h-6 w-6 rounded-full bg-accent flex items-center justify-center hover:bg-input" onClick={(e) => e.stopPropagation()}>
                                                                    <Info className="h-3 w-3 text-muted-foreground" />
                                                                </button>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="left" className="max-w-64">{model.description}</TooltipContent>
                                                        </Tooltip>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                    {legacyModels.length > 0 && (
                                        <div className="mt-2 border-t border-border">
                                            <button onClick={() => setShowLegacy(!showLegacy)} className="w-full flex items-center gap-2 px-4 py-3 text-base text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
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
