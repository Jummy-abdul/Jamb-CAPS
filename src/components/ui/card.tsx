import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(15,27,51,0.04)]", className)}>{children}</div>;
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = "navy" }: { label: string; value: string | number; hint?: string; icon: LucideIcon; tone?: "navy" | "green" | "amber" | "violet" | "sky" }) {
  const toneClass = {
    navy: "bg-navy-50 text-navy-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
    sky: "bg-sky-50 text-sky-700",
  }[tone];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-ink">{typeof value === "number" ? value.toLocaleString("en-NG") : value}</p>
        </div>
        <span className={cn("grid size-10 place-items-center rounded-lg", toneClass)}>
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
      {hint && <p className="mt-3 text-xs text-muted">{hint}</p>}
    </Card>
  );
}
