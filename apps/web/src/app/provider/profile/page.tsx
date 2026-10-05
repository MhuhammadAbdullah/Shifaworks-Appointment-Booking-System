"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/app-shell";
import { AccountIdentityCards } from "@/components/account/account-identity-cards";
import { ProviderProfileForm } from "@/components/providers/provider-profile-form";
import { useOwnProvider, useUpdateOwnProvider } from "@/lib/api/catalog";

export default function ProviderOwnProfilePage() {
  const { data: provider, isPending, error } = useOwnProvider();
  const update = useUpdateOwnProvider();

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !provider) return <p className="text-destructive">{error?.message ?? "Profile not found"}</p>;

  return (
    <div className="grid gap-6">
      <PageHeader title="My profile" description="This is what customers see when choosing who to book with." />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <ProviderProfileForm
          provider={provider}
          mode="self"
          onSave={({ designation, bio, specializations, phone, profileImageId }) =>
            update.mutateAsync({ designation, bio, specializations, phone, profileImageId })
          }
        />
        <Card className="content-start">
          <CardHeader>
            <CardTitle>Set by ShifaWorks</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div>
              <div className="mb-1 font-medium">Services</div>
              <div className="flex flex-wrap gap-1">
                {provider.services.length ? (
                  provider.services.map((s) => (
                    <Badge key={s.id} variant="secondary">
                      {s.name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">None yet</span>
                )}
              </div>
            </div>
            <div>
              <div className="mb-1 font-medium">Customers</div>
              {provider.acceptsMale && provider.acceptsFemale ? "Male and female" : provider.acceptsMale ? "Male only" : "Female only"}
            </div>
            <div>
              <div className="mb-1 font-medium">Experience</div>
              {provider.experienceYears} years{provider.rating && ` · rated ${provider.rating} / 5`}
            </div>
            <p className="text-muted-foreground">{provider.isActive ? "You are listed on the booking forms." : "You are not listed on the booking forms."}</p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Account</h2>
        <p className="mb-4 text-sm text-muted-foreground">Your name, phone and password for signing in — separate from the public card above.</p>
        <AccountIdentityCards />
      </div>
    </div>
  );
}
