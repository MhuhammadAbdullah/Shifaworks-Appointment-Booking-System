import type { PublicServiceDto } from "@booking/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SupportInline } from "./support-inline";

export function RegistrationClosed({ service }: { service: PublicServiceDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Registration Closed</CardTitle>
        <CardDescription>
          {service.name} isn&apos;t taking online bookings right now. Please get in touch and we&apos;ll help you directly.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SupportInline support={service.support} />
      </CardContent>
    </Card>
  );
}
