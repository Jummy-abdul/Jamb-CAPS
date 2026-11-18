import { cn } from "@/lib/utils";

const tones = {
  navy: "bg-navy-50 text-navy-700 ring-navy-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  gray: "bg-slate-100 text-slate-600 ring-slate-200",
} as const;

export type Tone = keyof typeof tones;

export function Badge({ tone = "gray", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

const APP_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Submitted", tone: "blue" },
  under_review: { label: "Under review", tone: "violet" },
  reviewed: { label: "Reviewed", tone: "navy" },
  on_hold: { label: "On hold", tone: "amber" },
  admitted: { label: "Admitted", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
};

export function ApplicationStatusBadge({ status }: { status: string }) {
  const s = APP_STATUS[status] ?? { label: status, tone: "gray" as Tone };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export const APPLICATION_STATUSES = Object.entries(APP_STATUS).map(([value, v]) => ({ value, label: v.label }));

export function SourceBadge({ source }: { source: string }) {
  if (source === "scim") return <Badge tone="green">Fixiam · SCIM</Badge>;
  if (source === "caps_native") return <Badge tone="navy">CAPS (pre-existing)</Badge>;
  return <Badge tone="gray">Sample record</Badge>;
}

export function ActiveBadge({ active, deleted }: { active: boolean; deleted?: boolean }) {
  if (deleted) return <Badge tone="red" dot>Deprovisioned</Badge>;
  return active ? <Badge tone="green" dot>Active</Badge> : <Badge tone="amber" dot>Deactivated</Badge>;
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  if (outcome === "success") return <Badge tone="green">Success</Badge>;
  if (outcome === "denied") return <Badge tone="amber">Denied</Badge>;
  return <Badge tone="red">Failure</Badge>;
}

export function HttpStatusBadge({ code }: { code: number }) {
  const tone: Tone = code < 300 ? "green" : code < 400 ? "blue" : code < 500 ? "amber" : "red";
  return <Badge tone={tone} className="font-mono">{code}</Badge>;
}
