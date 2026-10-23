import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-text hover:bg-accent-hover shadow-sm",
  secondary: "bg-surface-2 text-text hover:bg-surface-3",
  outline: "border border-border bg-surface text-text hover:bg-surface-2 hover:border-border-strong shadow-sm",
  ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
  danger: "bg-danger text-danger-text hover:opacity-90 shadow-sm",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5 rounded-md",
  md: "h-8.5 px-3.5 text-sm gap-2 rounded-lg",
  lg: "h-10 px-5 text-[15px] gap-2 rounded-lg",
  icon: "h-8.5 w-8.5 rounded-lg",
  "icon-sm": "h-7 w-7 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, className, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,border-color,opacity] duration-150 select-none",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  );
});
