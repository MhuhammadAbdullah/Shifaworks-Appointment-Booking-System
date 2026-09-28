"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const GERUND: Record<string, string> = { Delete: "Deleting", Void: "Voiding" };

/** A bar shown above a table once one or more rows are selected, offering a bulk action (delete by default, or void for records that are never hard-deleted). */
export function BulkActionBar({
  count,
  noun,
  onDelete,
  onClear,
  deleting = false,
  verb = "Delete",
}: {
  count: number;
  noun: string;
  onDelete: () => void;
  onClear: () => void;
  deleting?: boolean;
  verb?: "Delete" | "Void";
}) {
  if (count === 0) return null;
  const gerund = GERUND[verb] ?? `${verb}ing`;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
      <span className="font-medium">
        {count} {noun}
        {count === 1 ? "" : "s"} selected
      </span>
      <Button variant="destructive" size="sm" disabled={deleting} onClick={onDelete}>
        <Trash2 className="size-4" /> {deleting ? `${gerund}…` : `${verb} selected`}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
