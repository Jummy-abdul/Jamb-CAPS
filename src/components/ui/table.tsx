import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-line bg-slate-50/70 text-xs font-medium uppercase tracking-wide text-muted">{children}</thead>;
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th scope="col" className={cn("px-4 py-3 font-medium", className)}>{children}</th>;
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={cn("transition-colors hover:bg-navy-50/40", className)}>{children}</tr>;
}

export function Td({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn("px-4 py-3 align-middle text-ink", className)}>{children}</td>;
}

/** Server-rendered pagination that preserves the current query string. */
export function Pagination({ page, pageSize, total, basePath, params }: { page: number; pageSize: number; total: number; basePath: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = "inline-flex items-center gap-1 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-slate-50";
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
      <span>
        Showing <b className="text-ink">{from}</b>–<b className="text-ink">{to}</b> of <b className="text-ink">{total.toLocaleString("en-NG")}</b>
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? <Link className={btn} href={href(page - 1)}><ChevronLeft className="size-3.5" />Previous</Link> : <span className={cn(btn, "opacity-40")}><ChevronLeft className="size-3.5" />Previous</span>}
        <span>Page {page} of {pages}</span>
        {page < pages ? <Link className={btn} href={href(page + 1)}>Next<ChevronRight className="size-3.5" /></Link> : <span className={cn(btn, "opacity-40")}>Next<ChevronRight className="size-3.5" /></span>}
      </div>
    </div>
  );
}
