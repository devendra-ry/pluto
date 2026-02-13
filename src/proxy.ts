import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

export async function proxy(request: NextRequest) {
    const { supabase, supabaseResponse } = createClient(request);

    // This will refresh the session if needed
    const { data: { user } } = await supabase.auth.getUser();

    const { pathname } = request.nextUrl;

    // Protect chat routes
    if (pathname.startsWith('/c/') && !user) {
        const url = request.nextUrl.clone();
        url.pathname = '/login';
        return NextResponse.redirect(url);
    }

    return supabaseResponse;
}

export const config = {
    matcher: [
        // Restrict middleware auth checks to protected chat routes.
        '/c/:path*',
    ],
};
