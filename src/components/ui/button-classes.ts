// Button styling, kept out of the client-only primitives module so server
// components can style links as buttons too.
import clsx from "clsx";

export type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  // Monochrome with a faint top-lit gradient, like a glass key.
  primary:
    "bg-accent bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent-fg)_14%,var(--accent)),var(--accent)_60%)] text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_1px_2px_rgb(0_0_0/0.12),0_4px_12px_-4px_color-mix(in_srgb,var(--accent)_60%,transparent)] hover:brightness-110 active:brightness-95 disabled:opacity-40 disabled:shadow-none",
  secondary: "glass-card text-fg hover:bg-surface-solid disabled:opacity-50",
  outline: "border border-border-strong text-fg hover:bg-surface-2 disabled:opacity-50",
  ghost: "text-muted hover:text-fg hover:bg-surface-2 disabled:opacity-40",
  danger: "bg-danger text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(0_0_0/0.12)] hover:brightness-110 disabled:opacity-40",
};
const SIZES: Record<Size, string> = {
  // A little taller on phones, for thumbs.
  sm: "h-7 max-sm:h-8 px-3 text-[13px] gap-1.5 rounded-full",
  md: "h-8 max-sm:h-9 px-3.5 text-[13px] gap-2 rounded-full",
  lg: "h-10 px-5 text-sm gap-2 rounded-full",
};

const buttonBase =
  "inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background,opacity,color,box-shadow,filter,transform] duration-[var(--dur)] ease-[var(--ease)] active:scale-[0.98] disabled:active:scale-100 disabled:cursor-not-allowed";

export function buttonClasses(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return clsx(buttonBase, VARIANTS[variant], SIZES[size], className);
}
