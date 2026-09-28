"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const GERUND: Record<string, string> = { Delete: "Deleting", Void: "Voiding" };

/** Confirms a bulk action (delete by default, or void); the caller reports per-item outcomes afterward since some rows may be guarded. */
export function BulkDeleteDialog({
  count,
  noun,
  description,
  deleting,
  onConfirm,
  onClose,
  verb = "Delete",
  reason,
  onReasonChange,
}: {
  count: number;
  noun: string;
  description: string;
  deleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
  verb?: "Delete" | "Void";
  /** When provided (with onReasonChange), shows a required reason field — used for void actions. */
  reason?: string;
  onReasonChange?: (v: string) => void;
}) {
  const gerund = GERUND[verb] ?? `${verb}ing`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {verb} {count} {noun}
            {count === 1 ? "" : "s"}?
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {onReasonChange && (
          <div className="grid gap-1.5">
            <Label htmlFor="bulk-action-reason">Reason</Label>
            <Textarea id="bulk-action-reason" rows={2} value={reason ?? ""} onChange={(e) => onReasonChange(e.target.value)} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={onConfirm}>
            {deleting ? `${gerund}…` : verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
