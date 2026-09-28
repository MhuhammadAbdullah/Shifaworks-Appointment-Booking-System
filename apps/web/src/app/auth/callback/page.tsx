"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/auth/redirect";

/**
 * Landing page for Supabase's own password-reset email (staff/provider
 * accounts — new ones get a password directly from the admin, never a link).
 * Handles both link styles Supabase can produce:
 *  - PKCE:     ?code=...                       (browser-initiated flows)
 *  - implicit: #access_token=...&refresh_token
 * The recommended token_hash template style is handled by /auth/confirm.
 */
function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const supabase = getSupabaseBrowserClient();
    const next = safeNextPath(params.get("next"), "/admin");

    async function run() {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const linkError = params.get("error_description") ?? hash.get("error_description");
      if (linkError) throw new Error(linkError);

      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
      } else if (hash.get("access_token") && hash.get("refresh_token")) {
        const { error } = await supabase.auth.setSession({
          access_token: hash.get("access_token")!,
          refresh_token: hash.get("refresh_token")!,
        });
        if (error) throw error;
      } else {
        throw new Error("This link is invalid or has already been used.");
      }
      router.replace(next);
      router.refresh();
    }

    run().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "This link is invalid or has expired.");
    });
  }, [params, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      {error ? (
        <div className="max-w-sm space-y-3 text-center">
          <p className="font-medium">We couldn&apos;t complete sign-in</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Link href="/login" className="text-sm font-medium hover:underline">
            Go to sign in
          </Link>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Signing you in…</p>
      )}
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <Callback />
    </Suspense>
  );
}
