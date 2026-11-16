import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-navy-800 text-white hover:bg-navy-700 focus-visible:ring-navy-300",
  secondary: "bg-white text-ink ring-1 ring-inset ring-line hover:bg-slate-50 focus-visible:ring-navy-300",
  success: "bg-emerald-700 text-white hover:bg-emerald-600 focus-visible:ring-emerald-300",
  danger: "bg-rose-700 text-white hover:bg-rose-600 focus-visible:ring-rose-300",
  warning: "bg-amber-500 text-navy-950 hover:bg-amber-400 focus-visible:ring-amber-300",
  ghost: "text-muted hover:bg-slate-100 hover:text-ink",
} as const;

export type ButtonVariant = keyof typeof variants;

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
    variants[variant],
  );
}

export function Button({ variant = "primary", size = "md", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <button className={cn(buttonClass(variant, size), className)} {...props} />;
}
