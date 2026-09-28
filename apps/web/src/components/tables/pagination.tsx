import type { PaginationMeta } from "@booking/shared";
import { Button } from "@/components/ui/button";

export function Pagination({
  meta,
  onPage,
  noun = "records",
}: {
  meta: PaginationMeta | undefined;
  onPage: (page: number) => void;
  noun?: string;
}) {
  if (!meta || meta.totalPages <= 1) {
    return meta ? <p className="mt-3 text-sm text-muted-foreground">{meta.total} {noun}</p> : null;
  }
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {meta.total} {noun} · page {meta.page} of {meta.totalPages}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
