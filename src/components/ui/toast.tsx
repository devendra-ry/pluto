'use client';

import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { cn } from '@/shared/core/utils';
import { X, AlertCircle, CheckCircle, Info } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FLUID_TRANSITION } from '@/shared/lib/motion';

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
            <div
                className="pointer-events-none fixed inset-x-4 bottom-4 z-[200] flex flex-col items-end gap-2 sm:left-auto sm:right-4 sm:w-[min(24rem,calc(100vw-2rem))]"
                role="region"
                aria-label="Notifications"
            >
                <AnimatePresence initial={false}>
                    {toasts.map(toast => (
                        <ToastItem
                            key={toast.id}
                            toast={toast}
                            onClose={removeToast}
                        />
                    ))}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: string) => void }) {
    const reduceMotion = useReducedMotion();
    useEffect(() => {
        const timer = setTimeout(() => onClose(toast.id), 4000);
        return () => clearTimeout(timer);
    }, [onClose, toast.id]);

    const icons = {
        success: <CheckCircle className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />,
        error: <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />,
        info: <Info className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />,
    };

    const backgrounds = {
        success: 'border-success/25 bg-card',
        error: 'border-destructive/30 bg-card',
        info: 'border-info/25 bg-card',
    };

    return (
        <motion.div
            layout="position"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 12, scale: reduceMotion ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : 6, scale: reduceMotion ? 1 : 0.98 }}
            transition={reduceMotion ? { duration: 0 } : FLUID_TRANSITION}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={cn(
                'pointer-events-auto flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-card-foreground shadow-xl',
                backgrounds[toast.type]
            )}
        >
            {icons[toast.type]}
            <span className="min-w-0 flex-1 break-words text-sm">{toast.message}</span>
            <button
                onClick={() => onClose(toast.id)}
                type="button"
                aria-label="Dismiss notification"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <X className="h-4 w-4" aria-hidden="true" />
            </button>
        </motion.div>
    );
}
