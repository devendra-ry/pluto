import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env/public";
import type { Database } from "@/utils/supabase/database.types";

export const createClient = () =>
    createBrowserClient<Database>(
        publicEnv.NEXT_PUBLIC_SUPABASE_URL,
        publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
