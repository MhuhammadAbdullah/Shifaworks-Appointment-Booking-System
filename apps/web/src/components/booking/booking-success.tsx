"use client";

import { useState } from "react";
import { Check, CheckCircle2, Copy, Home } from "lucide-react";
import type { PublicBookingResponse } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { publicEnv } from "@/lib/env";
import { formatDate, formatMoney, hhmmTo12Hour } from "@/lib/format";
import { hasSupportContacts, SupportInline } from "./support-inline";

function CopyReference({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function BookingSuccess({ result }: { result: PublicBookingResponse }) {
  const receiptAttached = result.status === "PAYMENT_SUBMITTED";
  const a = result.appointment;
  const pay = result.paymentInstructions;
  const payRows = (
    [
      ["Bank", pay.bankName],
      ["Account title", pay.accountTitle],
      ["Account number", pay.accountNumber],
      ["IBAN", pay.iban],
      ["JazzCash", pay.jazzcash],
      ["Easypaisa", pay.easypaisa],
    ] as [string, string][]
  ).filter(([, v]) => v);
  const summary: [string, string][] = [
    ["Service", a.serviceName],
    ["Session", a.packageName],
    ["With", a.providerName],
    ["Date", a.startsAt ? formatDate(a.startsAt, a.timezone) : a.date],
    ["Time", hhmmTo12Hour(a.time)],
    ["Amount", formatMoney(result.amount, result.currency)],
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-6" />
          <CardTitle className="text-lg">Booking request received</CardTitle>
        </div>
        <CardDescription>
          {receiptAttached
            ? "We've received your payment receipt and it's being reviewed."
            : "Your time is held for you. It is confirmed once we verify your payment."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 p-3">
          <div>
            <p className="text-xs text-muted-foreground">Your reference</p>
            <p className="font-mono text-base font-semibold">{result.bookingNumber}</p>
          </div>
          <CopyReference value={result.bookingNumber} />
        </div>

        <div className="grid gap-1 rounded-md border p-3 text-sm">
          {summary.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{label}</span>
              <span className="text-right font-medium">{value}</span>
            </div>
          ))}
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium">What happens next</p>
          <ol className="grid list-decimal gap-1 pl-5 text-sm text-muted-foreground">
            {receiptAttached ? (
              <>
                <li>We check your receipt.</li>
                <li>You get a confirmation email once the payment is verified.</li>
              </>
            ) : (
              <>
                <li>
                  Pay {formatMoney(result.amount, result.currency)} using the details below. They have also been emailed to you.
                </li>
                <li>Send us your receipt (reply to the email or message us).</li>
                <li>You get a confirmation email once the payment is verified.</li>
              </>
            )}
          </ol>
        </div>

        {!receiptAttached && payRows.length > 0 && (
          <div className="grid gap-1.5 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="mb-1 font-medium">Payment details</p>
            {payRows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{label}</span>
                <span className="text-right font-medium">{value}</span>
              </div>
            ))}
            {pay.instructions && <p className="pt-1 text-muted-foreground">{pay.instructions}</p>}
          </div>
        )}

        {hasSupportContacts(result.support) && (
          <div>
            <p className="mb-2 text-sm font-medium">Questions or need to change something?</p>
            <SupportInline support={result.support} />
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline">
          <a href={publicEnv.NEXT_PUBLIC_WEBSITE_URL}>
            <Home className="size-4" /> Back to website
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}
