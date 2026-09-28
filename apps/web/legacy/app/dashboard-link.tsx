"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { homePathFor, useMe } from "@/lib/auth/hooks";

export function DashboardLink() {
  const { data: me, isPending } = useMe();
  return (
    <Button asChild disabled={isPending}>
      <Link href={me ? homePathFor(me) : "/portal"}>Go to your dashboard</Link>
    </Button>
  );
}
