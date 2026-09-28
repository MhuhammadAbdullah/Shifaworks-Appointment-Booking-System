"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/app-shell";
import { AvailabilityEditor } from "@/components/availability/availability-editor";
import { usePermissions } from "@/lib/auth/hooks";
import { useOwnProvider } from "@/lib/api/catalog";

export default function ProviderAvailabilityPage() {
  const { can } = usePermissions();
  const { data: provider, isPending, error } = useOwnProvider();

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !provider) return <p className="text-destructive">{error?.message ?? "Profile not found"}</p>;

  return (
    <div className="grid gap-6">
      <PageHeader title="My availability" description="Customers can only book times inside these hours." />
      <AvailabilityEditor providerId={provider.id} readOnly={!can("availability.manage_own") && !can("availability.manage_all")} />
    </div>
  );
}
