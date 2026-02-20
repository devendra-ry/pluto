import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env/public";
import type { Database } from "@/utils/supabase/database.types";

let browserClient: SupabaseClient<Database> | undefined;

export const createClient = () => {
    if (typeof window === "undefined") {
        return createBrowserClient<Database>(
            publicEnv.NEXT_PUBLIC_SUPABASE_URL,
            publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        );
    }

    if (!browserClient) {
        browserClient = createBrowserClient<Database>(
            publicEnv.NEXT_PUBLIC_SUPABASE_URL,
            publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        );
    }

    return browserClient;
};
