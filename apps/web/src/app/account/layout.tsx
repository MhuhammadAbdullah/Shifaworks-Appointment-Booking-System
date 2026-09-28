"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMe, homePathFor } from "@/lib/auth/hooks";

export default function AccountLayout({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="flex h-14 items-center border-b bg-background px-4">
        <Link
          href={(me && homePathFor(me)) ?? "/admin"}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to dashboard
        </Link>
      </header>
      <main className="mx-auto w-full max-w-xl px-4 py-8">{children}</main>
    </div>
  );
}
