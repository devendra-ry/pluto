'use client';

import { createClient } from '@/shared/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { FLUID_EASE } from '@/shared/lib/motion';
import { useEffect, useRef, useState } from 'react';

export default function LoginPage() {
    const [supabase] = useState(() => createClient());
    const signingInRef = useRef(false);
    const [isSigningIn, setIsSigningIn] = useState(false);
    const [signInError, setSignInError] = useState<string | null>(null);
    const shouldReduceMotion = useReducedMotion();

    const entranceTransition = (delay: number) => ({
        type: 'tween' as const,
        duration: shouldReduceMotion ? 0.2 : 0.55,
        delay: shouldReduceMotion ? 0 : delay,
        ease: FLUID_EASE,
    });

    useEffect(() => {
        const error = new URLSearchParams(window.location.search).get('error');
        if (error === 'auth_failed') {
            setSignInError('Google sign-in could not be completed. Please try again.');
        }
    }, []);

    const handleLogin = async () => {
        if (signingInRef.current) return;
        signingInRef.current = true;
        setIsSigningIn(true);
        setSignInError(null);
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: `${window.location.origin}/auth/callback`,
                },
            });
            if (error) throw error;
        } catch (error) {
            console.error('[login] Unable to start Google sign-in:', error);
            setSignInError('Could not open Google sign-in. Check your connection and try again.');
        } finally {
            signingInRef.current = false;
            setIsSigningIn(false);
        }
    };

    return (
        <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
            <div className="flex flex-col items-center max-w-sm w-full space-y-8">
                {/* Logo and Header */}
                <div className="flex flex-col items-center space-y-4">
                    <motion.div
                        initial={{ scale: shouldReduceMotion ? 1 : 0.94, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={entranceTransition(0)}
                        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20"
                    >
                        <MessageSquare className="w-10 h-10 text-primary-foreground fill-current" aria-hidden="true" />
                    </motion.div>

                    <motion.h1
                        initial={{ y: shouldReduceMotion ? 0 : 8, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={entranceTransition(0.08)}
                        className="text-2xl font-bold tracking-tight text-foreground"
                    >
                        Sign in to Pluto
                    </motion.h1>
                </div>

                {/* Login Card */}
                <motion.div
                    initial={{ y: shouldReduceMotion ? 0 : 12, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={entranceTransition(0.14)}
                    className="w-full rounded-3xl border border-border bg-card p-6 shadow-xl shadow-black/20 sm:p-8"
                >
                    {signInError && (
                        <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {signInError}
                        </p>
                    )}
                    <Button
                        onClick={handleLogin}
                        disabled={isSigningIn}
                        aria-busy={isSigningIn}
                        variant="outline"
                        className="h-12 w-full justify-center gap-3 rounded-xl border-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring group"
                    >
                        <svg aria-hidden="true" className="w-5 h-5 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                            <path
                                fill="#4285F4"
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            />
                            <path
                                fill="#34A853"
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                                fill="#FBBC05"
                                d="M5.84 14.1c-.22-.66-.35-1.39-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
                            />
                            <path
                                fill="#EA4335"
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                            />
                        </svg>
                        {isSigningIn ? 'Opening Google sign-in…' : 'Continue with Google'}
                    </Button>
                </motion.div>

                {/* Footer */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={entranceTransition(0.2)}
                    className="text-center"
                >
                    <p className="text-sm text-muted-foreground">
                        Secure sign-in powered by Google
                    </p>
                </motion.div>
            </div>
        </main>
    );
}
