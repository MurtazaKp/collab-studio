import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost";
type Size = "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-text hover:bg-accent-hover shadow-sm",
  outline: "border border-border bg-surface text-text hover:bg-surface-2 hover:border-border-strong shadow-sm",
  ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
};

const SIZES: Record<Size, string> = {
  md: "h-9 px-3.5 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-lg",
};

/** Button styling for real <a>/<Link> elements, so links are never nested inside <button>. */
export function ctaClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,border-color] duration-150",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}
