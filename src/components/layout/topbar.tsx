import { LogOut, ShieldCheck } from "lucide-react";
import { initials } from "@/lib/utils";

export function Topbar({ name, email, roles }: { name: string; email: string | null; roles: string[] }) {
  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b border-line bg-white px-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">Admissions Administration and Processing Portal</p>
        <p className="truncate text-xs text-muted">2026/2027 admission exercise</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-1.5 sm:flex">
          {roles.length === 0 ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-muted">No role assigned</span>
          ) : (
            roles.map((r) => (
              <span key={r} className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2.5 py-0.5 text-xs font-medium text-navy-700">
                <ShieldCheck className="size-3" aria-hidden />
                {r}
              </span>
            ))
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-navy-800 text-xs font-semibold text-white" aria-hidden>
            {initials(name)}
          </span>
          <div className="hidden leading-tight lg:block">
            <p className="text-sm font-medium text-ink">{name}</p>
            <p className="text-xs text-muted">{email}</p>
          </div>
        </div>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted hover:bg-slate-100 hover:text-ink">
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </form>
      </div>
    </header>
  );
}
