import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/shared/lib/supabase/middleware";

function buildCsp(nonce: string) {
    const isDev = process.env.NODE_ENV !== 'production';
    const isProd = process.env.NODE_ENV === 'production';
    const scriptSrc = [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        // React Refresh and Next.js dev tooling require eval in development.
        isDev ? "'unsafe-eval'" : '',
        // Host fallback for older browsers that ignore 'strict-dynamic'.
        'https://va.vercel-scripts.com',
        'https://vercel.live',
    ].filter(Boolean).join(' ');

    return [
        "default-src 'self'",
        `script-src ${scriptSrc}`,
        // Next.js injects inline styles; keeping this is required.
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' blob: data: https://*.supabase.co",
        "media-src 'self' blob: data: https://*.supabase.co",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com https://*.vercel-insights.com https://*.vercel-scripts.com",
        "frame-src 'self' https://vercel.live",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        isProd ? 'upgrade-insecure-requests' : '',
    ].filter(Boolean).join('; ');
}

export async function proxy(request: NextRequest) {
    const nonce = btoa(crypto.randomUUID());
    const csp = buildCsp(nonce);
    const { supabase, supabaseResponse } = createClient(request, {
        nonce,
        contentSecurityPolicy: csp,
    });

    // Authenticate user by contacting the Supabase Auth server.
    const { data: { user } } = await supabase.auth.getUser();

    const { pathname } = request.nextUrl;

    if (!user) {
        // Protect API routes with a 401 response shape suitable for fetch callers.
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Protect chat routes with login redirect UX.
        if (pathname.startsWith('/c/')) {
            const url = request.nextUrl.clone();
            url.pathname = '/login';
            return NextResponse.redirect(url);
        }
    }

    supabaseResponse.headers.set('Content-Security-Policy', csp);
    return supabaseResponse;
}

export const config = {
    matcher: [
        // Run on all routes except static assets and Next internals so the
        // CSP nonce + auth check apply to every document response.
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|map|woff|woff2|ttf)$).*)',
    ],
};
