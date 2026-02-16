import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

export async function proxy(request: NextRequest) {
    const { supabase, supabaseResponse } = createClient(request);

    // This will refresh the session if needed
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

    return supabaseResponse;
}

export const config = {
    matcher: [
        // Restrict middleware auth checks to protected chat and API routes.
        '/c/:path*',
        '/api/:path*',
    ],
};
