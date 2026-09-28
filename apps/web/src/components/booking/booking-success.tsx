import { CheckCircle2, Home } from "lucide-react";
import type { PublicBookingResponse } from "@booking/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { publicEnv } from "@/lib/env";
import { hhmmTo12Hour } from "@/lib/format";
import { hasSupportContacts, SupportInline } from "./support-inline";

export function BookingSuccess({ result }: { result: PublicBookingResponse }) {
  const receiptAttached = result.status === "PAYMENT_SUBMITTED";
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-5" />
          <CardTitle>Booking request received</CardTitle>
        </div>
        <CardDescription>
          Reference <span className="font-mono font-medium text-foreground">{result.bookingNumber}</span> - we&apos;ve saved your appointment for{" "}
          {result.appointment.date} at {hhmmTo12Hour(result.appointment.time)} with {result.appointment.providerName}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm">
          {receiptAttached
            ? "We've received your payment receipt and it's being reviewed. You'll get a confirmation email once it's verified."
            : `Your booking isn't confirmed yet. Payment details have been sent to your email. Please complete the payment of (${result.amount} ${result.currency}) using those details. Your booking will be confirmed once we verify the payment.`}
        </p>
        {hasSupportContacts(result.support) && (
          <div>
            <p className="mb-2 text-sm font-medium">Questions? Get in touch</p>
            <SupportInline support={result.support} />
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline">
          <a href={publicEnv.NEXT_PUBLIC_WEBSITE_URL}>
            <Home className="size-4" /> Go back to home
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}
