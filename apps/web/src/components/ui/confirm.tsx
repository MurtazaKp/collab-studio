"use client";

import { useEffect, useState } from "react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogFooter } from "./dialog";
import { Field, Input } from "./field";
import { Notice } from "./misc";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (err) {
                setError((err as Error).message || "Something went wrong.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialValue = "",
  placeholder,
  submitLabel = "Save",
  maxLength = 120,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  label: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  maxLength?: number;
  onSubmit: (value: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reset only when the dialog opens, so a teammate's live rename arriving
  // while you type doesn't overwrite your input.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValue(initialValue);
      setError(null);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!value.trim()) return;
            setBusy(true);
            setError(null);
            try {
              await onSubmit(value.trim());
              onOpenChange(false);
            } catch (err) {
              setError((err as Error).message || "Something went wrong.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {error ? <Notice tone="danger" className="mb-3">{error}</Notice> : null}
          <Field label={label}>
            {(p) => (
              <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} maxLength={maxLength} placeholder={placeholder} autoFocus required />
            )}
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!value.trim()}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
