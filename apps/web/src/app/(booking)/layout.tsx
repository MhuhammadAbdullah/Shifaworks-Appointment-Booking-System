"use client";

import type { ReactNode } from "react";
import { publicEnv } from "@/lib/env";
import { usePublicBranding } from "@/lib/api/public";

export default function BookingLayout({ children }: { children: ReactNode }) {
  const { data } = usePublicBranding();

  return (
    <main className="min-h-dvh bg-muted/30 px-4 py-8 sm:py-12">
      <div className="mx-auto mb-8 max-w-xl text-center">
        <a href={publicEnv.NEXT_PUBLIC_WEBSITE_URL} className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-muted-foreground hover:text-foreground">
          {data?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
            <img src={data.logoUrl} alt={data.name} className="h-20 w-auto object-contain sm:h-24" />
          ) : (
            <span>{data?.name ?? "ShifaWorks"}</span>
          )}
        </a>
      </div>
      {children}
    </main>
  );
}
