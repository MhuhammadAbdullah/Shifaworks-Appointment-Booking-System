"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { meQueryKey } from "@/lib/auth/hooks";

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  if (pathname.startsWith("/login")) return;
  window.location.assign(`/login?next=${encodeURIComponent(pathname + search)}`);
}

function makeQueryClient(): QueryClient {
  const onError = (error: unknown) => {
    // The API rejected our session (expired refresh token, disabled account).
    if (error instanceof ApiError && error.status === 401) {
      void getSupabaseBrowserClient().auth.signOut().finally(redirectToLogin);
    }
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Never retry client errors (401/403/404/422); retry transient ones twice.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  useEffect(() => {
    const { data } = getSupabaseBrowserClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") queryClient.clear();
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        void queryClient.invalidateQueries({ queryKey: meQueryKey });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
