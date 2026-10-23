import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm text-text shadow-sm transition-[border-color,box-shadow] placeholder:text-muted " +
  "hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-[var(--ring)] " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(control, "h-8.5", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(control, "min-h-20 py-2 leading-relaxed", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className={cn("relative", className)}>
      <select ref={ref} className={cn(control, "h-8.5 appearance-none pr-8")} {...props}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
});

/** Label + control + hint/error, with ids wired for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-text-2">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
