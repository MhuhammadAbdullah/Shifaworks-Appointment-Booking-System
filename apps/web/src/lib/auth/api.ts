"use client";

import { apiRequest, type ApiResult, type RequestOptions } from "@/lib/api-client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * API call with the current Supabase access token. getSession() refreshes an
 * expired token before returning it, so callers never send a stale JWT.
 */
export async function authedRequest<T>(
  path: string,
  opts: Omit<RequestOptions, "accessToken"> = {},
): Promise<ApiResult<T>> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  return apiRequest<T>(path, { ...opts, accessToken: data.session?.access_token ?? null });
}
