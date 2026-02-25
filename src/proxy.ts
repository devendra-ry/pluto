import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

export async function proxy(request: NextRequest) {
    const { supabase, supabaseResponse } = createClient(request);

    // Refresh session cookie locally (JWT parse only — no network call).
    // Actual server-verified auth happens in route handlers via requireUser().
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;

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

    return supabaseResponse;
}

export const config = {
    matcher: [
        // Restrict middleware auth checks to protected chat and API routes.
        '/c/:path*',
        '/api/:path*',
    ],
};