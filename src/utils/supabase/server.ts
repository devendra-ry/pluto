import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/shared/config/public";
import { cookies } from "next/headers";
import type { Database } from "@/utils/supabase/database.types";

export const createClient = (cookieStore: Awaited<ReturnType<typeof cookies>>) => {
    return createServerClient<Database>(
        publicEnv.NEXT_PUBLIC_SUPABASE_URL,
        publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
                    } catch {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            },
        },
    );
};

