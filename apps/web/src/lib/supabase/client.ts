"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

let browserClient: SupabaseClient | undefined;

/** Browser Supabase client — used for auth only (sign-in, session refresh). */
export function getSupabaseBrowserClient(): SupabaseClient {
  browserClient ??= createBrowserClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return browserClient;
}
