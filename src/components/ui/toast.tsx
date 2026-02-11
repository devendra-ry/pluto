'use client';

import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { X, AlertCircle, CheckCircle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = crypto.randomUUID();
        setToasts(prev => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2">
                {toasts.map(toast => (
                    <ToastItem
                        key={toast.id}
                        toast={toast}
                        onClose={() => removeToast(toast.id)}
                    />
                ))}
            </div>
        </ToastContext.Provider>
    );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
    useEffect(() => {
        const timer = setTimeout(onClose, 4000);
        return () => clearTimeout(timer);
    }, [onClose]);

    const icons = {
        success: <CheckCircle className="h-4 w-4 text-emerald-400" />,
        error: <AlertCircle className="h-4 w-4 text-red-400" />,
        info: <Info className="h-4 w-4 text-blue-400" />,
    };

    const backgrounds = {
        success: 'border-emerald-500/20 bg-emerald-950/80',
        error: 'border-red-500/20 bg-red-950/80',
        info: 'border-blue-500/20 bg-blue-950/80',
    };

    return (
        <div
            className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-lg shadow-2xl',
                'animate-in slide-in-from-right-5 fade-in duration-300',
                backgrounds[toast.type]
            )}
        >
            {icons[toast.type]}
            <span className="text-base text-zinc-100">{toast.message}</span>
            <button
                onClick={onClose}
                className="ml-2 p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
