import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-12">
      <div className="text-center">
        <p className="text-lg font-semibold tracking-tight">ShifaWorks</p>
        <p className="text-sm text-muted-foreground">Staff &amp; provider sign-in</p>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
