import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link href="/" className="font-semibold tracking-tight">
            Wellness Practice
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link href="/services" className="hover:text-foreground">
              Services
            </Link>
            <Link href="/events" className="hover:text-foreground">
              Events
            </Link>
            <Link href="/providers" className="hover:text-foreground">
              Our team
            </Link>
          </nav>
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>
    </div>
  );
}
