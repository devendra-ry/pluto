'use client';

import React from 'react';

interface ErrorBoundaryProps {
    children: React.ReactNode;
    fallback?: React.ReactNode;
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        this.props.onError?.(error, errorInfo);
    }

    private handleReset = () => {
        this.setState({ hasError: false });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }
            return (
                <div className="m-4 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-zinc-100">
                    <p className="text-sm font-semibold">Something went wrong.</p>
                    <button
                        onClick={this.handleReset}
                        className="mt-3 rounded-md border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
                    >
                        Try again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
