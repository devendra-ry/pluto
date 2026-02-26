'use client';

import { useEffect, useMemo, useRef } from 'react';

interface ChatVideoPlayerProps {
    url: string;
    mimeType: string;
    className?: string;
}

const HLS_MIME_TYPES = new Set([
    'application/vnd.apple.mpegurl',
    'application/x-mpegurl',
]);

function isHlsSource(url: string, mimeType: string) {
    if (HLS_MIME_TYPES.has(mimeType.toLowerCase())) return true;
    try {
        const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
        return parsed.pathname.toLowerCase().endsWith('.m3u8');
    } catch {
        return url.toLowerCase().includes('.m3u8');
    }
}

export function ChatVideoPlayer({ url, mimeType, className }: ChatVideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const shouldUseHls = useMemo(() => isHlsSource(url, mimeType), [url, mimeType]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        let cleanup: (() => void) | undefined;
        let cancelled = false;

        const attachNative = () => {
            video.src = url;
            video.load();
            cleanup = () => {
                video.removeAttribute('src');
                video.load();
            };
        };

        if (!shouldUseHls) {
            attachNative();
            return () => cleanup?.();
        }

        void (async () => {
            try {
                if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    attachNative();
                    return;
                }

                const { default: Hls } = await import('hls.js');
                if (cancelled) return;
                if (!Hls.isSupported()) {
                    attachNative();
                    return;
                }

                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                });
                hls.loadSource(url);
                hls.attachMedia(video);
                cleanup = () => {
                    hls.destroy();
                };
            } catch {
                attachNative();
            }
        })();

        return () => {
            cancelled = true;
            cleanup?.();
        };
    }, [url, shouldUseHls]);

    return (
        <video
            ref={videoRef}
            controls
            preload="metadata"
            playsInline
            className={className}
        />
    );
}
