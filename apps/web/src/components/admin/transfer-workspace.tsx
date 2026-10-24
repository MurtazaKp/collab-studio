"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { adminTransferWorkspaceAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";

/** Platform admin: move one workspace to another account, found by email. */
export function TransferWorkspaceButton({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = () => {
    setOpen(false);
    setEmail("");
    setReason("");
    setError(null);
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Transfer ${workspaceName}`}>
        <KeyRound className="size-3.5" /> Transfer
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent
          title={`Transfer “${workspaceName}”`}
          description="The new owner joins as Owner if they aren't a member yet, and the current owner stays on as an Admin. The workspace then runs on the new owner's plan, which needs room for another workspace."
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                try {
                  const res = await adminTransferWorkspaceAction({ workspaceId, email, reason });
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  toast.success("Workspace transferred");
                  close();
                  router.refresh();
                } catch {
                  setError("Your session may have expired. Refresh and sign in again.");
                }
              });
            }}
          >
            <Field label="New owner's email" hint="They must already have an account." error={error}>
              {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}
            </Field>
            <Field label="Reason (recorded in the audit log)" hint="Optional, up to 500 characters.">
              {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />}
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={pending} disabled={!email.trim()}>
                Transfer workspace
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
