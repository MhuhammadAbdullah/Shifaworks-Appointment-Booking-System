"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { homeAreaFor, type AppArea, type MeResponse, type PermissionKey } from "@booking/shared";
import { authedRequest } from "./api";

export const meQueryKey = ["auth", "me"] as const;

export function useMe(enabled = true) {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: ({ signal }) => authedRequest<MeResponse>("/auth/me", { signal }).then((r) => r.data),
    staleTime: 60_000,
    enabled,
  });
}

/**
 * Whether a Supabase session exists, without calling the API. Public pages use
 * this to decide whether to load /auth/me (a 401 there would trigger the
 * global sign-out redirect).
 */
export function useHasSession(): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    void supabase.auth.getSession().then(({ data }) => setHas(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setHas(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, []);
  return has;
}

/** UI-only permission check; the API re-checks every request. */
export function usePermissions() {
  const { data: me } = useMe();
  const can = useCallback(
    (permission: PermissionKey) => Boolean(me && (me.isSuperAdmin || me.permissions.includes(permission))),
    [me],
  );
  const canAny = useCallback((...permissions: PermissionKey[]) => permissions.some(can), [can]);
  return { me, can, canAny };
}

export const AREA_HOME: Record<AppArea, string> = {
  admin: "/admin",
  provider: "/provider",
};

/** The signed-in user's dashboard, or null when the account has no area (no access). */
export function homePathFor(me: MeResponse): string | null {
  const area = homeAreaFor(me);
  return area ? AREA_HOME[area] : null;
}
