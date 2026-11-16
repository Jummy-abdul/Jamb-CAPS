"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, ClipboardCheck, Gavel, Contact, UsersRound, KeyRound, RefreshCw, ScrollText, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CapsLogo } from "./logo";
import type { NavIcon } from "./nav";

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, applicants: Users, review: ClipboardCheck, decisions: Gavel, users: Contact,
  groups: UsersRound, roles: KeyRound, scim: RefreshCw, audit: ScrollText, settings: Settings,
};

export function Sidebar({ sections }: { sections: { section: string; items: { href: string; label: string; icon: NavIcon }[] }[] }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-navy-900 text-navy-100 md:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <CapsLogo />
        <div className="leading-tight">
          <p className="text-base font-bold tracking-wide text-white">CAPS</p>
          <p className="text-[11px] text-navy-300">Central Admission Processing</p>
        </div>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6 pt-2">
        {sections.map((s) => (
          <div key={s.section}>
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-navy-400">{s.section}</p>
            <ul className="space-y-0.5">
              {s.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                        active ? "bg-white/10 font-medium text-white shadow-[inset_3px_0_0_#34d399]" : "text-navy-200 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 px-5 py-4 text-[11px] leading-relaxed text-navy-300">
        Identity &amp; access managed by <span className="font-semibold text-white">Fixiam</span>
      </div>
    </aside>
  );
}

export function MobileNav({ sections }: { sections: { section: string; items: { href: string; label: string; icon: NavIcon }[] }[] }) {
  const pathname = usePathname();
  const items = sections.flatMap((s) => s.items);
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line bg-white px-3 py-2 md:hidden">
      {items.map((item) => (
        <Link key={item.href} href={item.href} className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-xs", pathname.startsWith(item.href) ? "bg-navy-800 text-white" : "text-muted hover:bg-slate-100")}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
