"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NotificationDetailView } from "./notification-detail-view";

/** The full email log entry, opened as a popup from the email log list instead of navigating to its own page. */
export function NotificationDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {/* NotificationDetailView renders its own heading (the template name); this is for screen readers only. */}
        <DialogTitle className="sr-only">Email log entry details</DialogTitle>
        <div className="overflow-y-auto p-6">
          <NotificationDetailView id={id} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
