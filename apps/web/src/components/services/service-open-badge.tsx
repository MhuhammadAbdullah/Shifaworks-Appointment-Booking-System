import type { ServiceDto } from "@booking/shared";
import { Badge } from "@/components/ui/badge";

/** "Open" only when the service is active AND accepting bookings (the form shows "Registration Closed" otherwise). */
export function ServiceOpenBadge({ service }: { service: Pick<ServiceDto, "open" | "isActive" | "bookingEnabled"> }) {
  if (service.open) return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Open</Badge>;
  return (
    <Badge variant="secondary" title={!service.isActive ? "Service inactive" : "Bookings paused"}>
      Registration closed
    </Badge>
  );
}
