"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { SetUserStatusInput, UserDetail } from "@booking/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSetUserStatus } from "@/lib/api/admin";
import { ApiError } from "@/lib/api-client";

type Target = SetUserStatusInput["status"];

const COPY: Record<Target, { title: string; body: string; action: string }> = {
  ACTIVE: {
    title: "Reactivate account",
    body: "The user will be able to sign in again with their existing password.",
    action: "Reactivate",
  },
  SUSPENDED: {
    title: "Suspend account",
    body: "The user is signed out and cannot sign in until reactivated. Their records are kept.",
    action: "Suspend",
  },
  DEACTIVATED: {
    title: "Deactivate account",
    body: "Use this when someone leaves. They cannot sign in; bookings, payments and history are kept for records.",
    action: "Deactivate",
  },
};

export function StatusActions({ user, canDeactivate }: { user: UserDetail; canDeactivate: boolean }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState("");
  const setStatus = useSetUserStatus(user.id);
  const disabled = user.status === "SUSPENDED" || user.status === "DEACTIVATED";

  function confirm() {
    if (!target) return;
    setStatus.mutate(
      { status: target, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          toast.success(`${COPY[target].action}d`);
          setTarget(null);
          setReason("");
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update status"),
      },
    );
  }

  return (
    <>
      {disabled ? (
        <Button variant="outline" onClick={() => setTarget("ACTIVE")}>
          Reactivate
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setTarget("SUSPENDED")}>
          Suspend
        </Button>
      )}
      {canDeactivate && user.status !== "DEACTIVATED" && (
        <Button variant="destructive" onClick={() => setTarget("DEACTIVATED")}>
          Deactivate
        </Button>
      )}

      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        {target && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{COPY[target].title}</DialogTitle>
              <DialogDescription>{COPY[target].body}</DialogDescription>
            </DialogHeader>
            {target !== "ACTIVE" && (
              <div className="grid gap-1.5">
                <Label htmlFor="status-reason">Reason (kept in the audit log)</Label>
                <Textarea
                  id="status-reason"
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setTarget(null)}>
                Cancel
              </Button>
              <Button
                variant={target === "ACTIVE" ? "default" : "destructive"}
                disabled={setStatus.isPending}
                onClick={confirm}
              >
                {setStatus.isPending ? "Working…" : COPY[target].action}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
