import type { RecordStatus } from "@booking/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLES: Record<RecordStatus, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  INACTIVE: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export function RecordStatusBadge({ status }: { status: RecordStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent capitalize", STYLES[status])}>
      {status.toLowerCase()}
    </Badge>
  );
}
