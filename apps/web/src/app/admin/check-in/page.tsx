"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, QrCode, Search, Ticket } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/dashboard/app-shell";
import { BookingStatusBadge } from "@/components/bookings/status-badges";
import { useCheckIn, useCheckInLookup, useResetCheckIn } from "@/lib/api/checkin";
import { usePermissions } from "@/lib/auth/hooks";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** Pulls a `token` from a scanned deep link, or accepts a raw token if the scanner read one directly. */
function extractToken(decoded: string): string | null {
  try {
    const url = new URL(decoded);
    return url.searchParams.get("token");
  } catch {
    return /^[0-9a-f-]{36}$/i.test(decoded) ? decoded : null;
  }
}

export default function CheckInPage() {
  const { can } = usePermissions();
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [token, setToken] = useState<string | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");

  const lookup = useCheckInLookup(token ? { token } : search ? { search } : null);
  const checkIn = useCheckIn();
  const reset = useResetCheckIn();

  function onScanned(decoded: string) {
    const t = extractToken(decoded);
    if (!t) return;
    setSearch(null);
    setToken(t);
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const value = searchInput.trim();
    if (!value) return;
    // An external USB/Bluetooth barcode scanner types into this field like a keyboard, then sends Enter —
    // so it may paste the ticket's full QR content (a deep link or raw token) rather than a booking number.
    const scanned = extractToken(value);
    if (scanned) {
      setSearch(null);
      setToken(scanned);
    } else {
      setToken(null);
      setSearch(value);
    }
  }

  return (
    <div>
      <PageHeader title="Check-in" description="Scan a ticket's QR code, or search by booking number, to check a customer in." />

      <Tabs value={mode} onValueChange={(v) => setMode(v as "scan" | "manual")} className="mb-4">
        <TabsList>
          <TabsTrigger value="scan">
            <QrCode className="size-4" /> Scan QR
          </TabsTrigger>
          <TabsTrigger value="manual">
            <Search className="size-4" /> Manual search
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "scan" ? (
        <Scanner onScanned={onScanned} />
      ) : (
        <form onSubmit={onSearch} className="mb-4 flex gap-2">
          <Input
            placeholder="Booking number, or scan a ticket with a USB/Bluetooth scanner"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            autoFocus
          />
          <Button type="submit">Search</Button>
        </form>
      )}

      {lookup.isPending && (token || search) && <p className="text-sm text-muted-foreground">Looking up…</p>}
      {lookup.error && <p className="text-sm text-destructive">{lookup.error.message}</p>}

      {lookup.data && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <Ticket className="size-4" /> {lookup.data.bookingNumber}
              </CardTitle>
              <BookingStatusBadge status={lookup.data.status} />
            </div>
            <CardDescription>{formatDateTime(lookup.data.startsAt, lookup.data.timezone)}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <Row label="Customer" value={lookup.data.customerName} />
              <Row label="Phone" value={lookup.data.customerPhone ?? "-"} />
              <Row label="Service" value={lookup.data.serviceName} />
              <Row label="Package" value={lookup.data.packageName ?? "-"} />
              <Row label="Provider" value={lookup.data.providerName} />
            </div>

            {lookup.data.checkedIn ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
                <span className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="size-4" />
                  Already checked in{lookup.data.checkedInAt ? ` - ${formatDateTime(lookup.data.checkedInAt, lookup.data.timezone)}` : ""}
                  {lookup.data.checkedInBy ? ` by ${lookup.data.checkedInBy}` : ""}
                </span>
                {can("bookings.check_in") && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reset.isPending}
                    onClick={() => {
                      if (!window.confirm("Reset this check-in? The customer will need to be checked in again.")) return;
                      reset.mutate(lookup.data.appointmentId, { onSuccess: () => toast.success("Check-in reset"), onError: (e) => toast.error(errorText(e, "Could not reset")) });
                    }}
                  >
                    Reset
                  </Button>
                )}
              </div>
            ) : lookup.data.status === "CONFIRMED" || lookup.data.status === "COMPLETED" ? (
              <Button
                className="w-full"
                disabled={checkIn.isPending}
                onClick={() =>
                  checkIn.mutate(lookup.data!.appointmentId, {
                    onSuccess: (r) => toast.success(r.alreadyCheckedIn ? "Already checked in" : "Checked in"),
                    onError: (e) => toast.error(errorText(e, "Could not check in")),
                  })
                }
              >
                <CheckCircle2 className="size-4" /> {checkIn.isPending ? "Checking in…" : "Check in"}
              </Button>
            ) : (
              <Badge variant="outline">Not confirmed yet - payment must be verified before check-in</Badge>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function Scanner({ onScanned }: { onScanned: (decoded: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const containerId = "checkin-qr-reader";
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let instance: import("html5-qrcode").Html5Qrcode | null = null;

    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (cancelled) return;
      instance = new Html5Qrcode(containerId, { verbose: false });
      scannerRef.current = instance;
      instance
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 240 },
          (decoded) => {
            if (decoded === lastRef.current) return; // debounce repeat frames of the same code
            lastRef.current = decoded;
            onScanned(decoded);
          },
          () => undefined, // per-frame "no code found" — not an error
        )
        .catch(() => setError("Could not access the camera. Check permissions, or use manual search instead."));
    });

    return () => {
      cancelled = true;
      instance
        ?.stop()
        .then(() => instance?.clear())
        .catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-mount the scanner itself, not on every onScanned identity change
  }, []);

  return (
    <div className="mb-4">
      <div id={containerId} className="overflow-hidden rounded-lg border" />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
