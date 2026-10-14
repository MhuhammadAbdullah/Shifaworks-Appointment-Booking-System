"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { SERVICE_SLUGS, type ProviderDto } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { publicEnv } from "@/lib/env";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copy()} aria-label={`Copy ${label}`}>
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function CopyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
        <CopyButton value={value} label={label} />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Check1({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />}
      <span>{children}</span>
    </li>
  );
}

/**
 * Everything needed to put this provider's live calendar on their WordPress profile page, in one place:
 * the address to paste into the page, a readiness check, and links to test it. The address (slug) cannot
 * be edited from the dashboard, so a page that has been linked stays linked.
 */
export function WebsiteCalendarCard({ provider }: { provider: ProviderDto }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const activeServices = provider.services.filter((s) => s.linkActive);
  const bookableSlugs = new Set<string>(SERVICE_SLUGS);
  const formServices = activeServices.filter((s) => bookableSlugs.has(s.slug));
  const ready = provider.isActive && formServices.length > 0;
  const apiCheck = `${publicEnv.NEXT_PUBLIC_API_URL.replace(/\/$/, "")}/api/v1/public/team/${provider.slug}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Website calendar</CardTitle>
        <CardDescription>
          Shows this {provider.providerType === "COUNSELLOR" ? "counsellor" : "therapist"}&apos;s live availability on their WordPress profile page. It updates by itself when
          you change availability here.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <CopyRow
          label="Provider address"
          value={provider.slug}
          hint="Paste this into the “Booking system provider” box on their WordPress page. It cannot be changed here, so the link keeps working."
        />

        <div className="grid gap-2">
          <p className="text-sm font-medium">Ready for the website?</p>
          <ul className="grid gap-1.5">
            <Check1 ok={provider.isActive}>{provider.isActive ? "Provider is active." : "Provider is inactive. The website will show only the Book Appointment button."}</Check1>
            <Check1 ok={formServices.length > 0}>
              {formServices.length > 0
                ? `Offers: ${formServices.map((s) => s.name).join(", ")}.`
                : "No active service is assigned. Assign one in the Services card below, or the website will show only the Book Appointment button."}
            </Check1>
            <Check1 ok={ready}>
              {ready
                ? "Each service also needs at least one active package, and weekly hours under the Availability tab, or no dates will appear."
                : "Fix the items above first."}
            </Check1>
          </ul>
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium">How to add it to WordPress</p>
          <ol className="grid list-decimal gap-1 pl-5 text-sm text-muted-foreground">
            <li>Copy the provider address above.</li>
            <li>In WordPress, open this person&apos;s team page for editing (Pages, then the page).</li>
            <li>Find the “Booking system provider” box in the sidebar, paste the address, and click Update.</li>
            <li>The box should turn green with “Linked to {provider.displayName}”. Open the page to see the calendar.</li>
          </ol>
        </div>

        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Test and troubleshooting links</summary>
          <div className="mt-3 grid gap-4">
            <CopyRow
              label="Shortcode (only if you place it by hand)"
              value={`[shifa_availability provider="${provider.slug}"]`}
              hint="Normally not needed: the shared Elementor template uses the address stored on each page."
            />
            {formServices.map((s) => {
              const url = `${origin}/${s.slug}?provider=${provider.slug}`;
              return (
                <div key={s.id} className="grid gap-1.5">
                  <p className="text-sm font-medium">{s.name} booking form for this provider</p>
                  <div className="flex gap-2">
                    <Input readOnly value={url} className="font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
                    <CopyButton value={url} label={`${s.name} link`} />
                    <Button asChild variant="outline" size="sm">
                      <a href={url} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-4" /> Open
                      </a>
                    </Button>
                  </div>
                </div>
              );
            })}
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">What the website receives</p>
              <div className="flex gap-2">
                <Input readOnly value={apiCheck} className="font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
                <Button asChild variant="outline" size="sm">
                  <a href={apiCheck} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" /> Open
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Opens the public data for this provider (name, services, packages). “Provider not found” means the provider is inactive or deleted.
              </p>
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
