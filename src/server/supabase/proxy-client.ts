import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/shared/config/public";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "@/shared/lib/supabase/database.types";

interface ProxyHeaders {
    /** Per-request nonce forwarded to Next.js for inline script tagging. */
    nonce?: string;
    /** CSP value; Next.js parses the nonce out of this request header. */
    contentSecurityPolicy?: string;
}

export const createClient = (request: NextRequest, headers?: ProxyHeaders) => {
    // Create an unmodified response
    const requestHeaders = new Headers(request.headers);
    if (headers?.nonce) {
        requestHeaders.set('x-nonce', headers.nonce);
    }
    if (headers?.contentSecurityPolicy) {
        // Next.js reads the nonce for its bootstrap scripts from here.
        requestHeaders.set('Content-Security-Policy', headers.contentSecurityPolicy);
    }

    let supabaseResponse = NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });

    const supabase = createServerClient<Database>(
        publicEnv.NEXT_PUBLIC_SUPABASE_URL,
        publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        },
    );

    return { supabase, supabaseResponse };
};