import type { UserStatus } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLES: Record<UserStatus, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  INVITED: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  SUSPENDED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  DEACTIVATED: "bg-muted text-muted-foreground",
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent capitalize", STYLES[status])}>
      {status.toLowerCase()}
    </Badge>
  );
}
