"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ProviderDetailView } from "@/components/providers/provider-detail-view";

/** Same screen as the popup on the providers list, on its own page (links, bookmarks). */
export default function ProviderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  return (
    <div className="grid gap-4">
      <Link href="/admin/providers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Providers
      </Link>
      <ProviderDetailView id={id} onClose={() => router.push("/admin/providers")} />
    </div>
  );
}
