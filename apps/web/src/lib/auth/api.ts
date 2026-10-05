"use client";

import { ApiError, apiRequest, type ApiResult, type RequestOptions } from "@/lib/api-client";
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
  try {
    return await apiRequest<T>(path, { ...opts, accessToken: data.session?.access_token ?? null });
  } catch (err) {
    // The API refuses everything but /account/set-password for a session that only ever
    // proved inbox access (clicked a reset link) — send the browser there, from wherever it was.
    if (
      err instanceof ApiError &&
      err.details?.["reason"] === "recovery_locked" &&
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/account/set-password")
    ) {
      window.location.replace("/account/set-password");
    }
    throw err;
  }
}
