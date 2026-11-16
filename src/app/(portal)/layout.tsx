import { redirect } from "next/navigation";
import { getPrincipalResult } from "@/lib/authz/principal";
import { NAV } from "@/components/layout/nav";
import { Sidebar, MobileNav } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { DemoBanner } from "@/components/layout/demo-banner";
import { ToastProvider } from "@/components/ui/toast";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const result = await getPrincipalResult();
  if (!result.ok) redirect(`/login?reason=${result.reason}`);
  const { principal } = result;

  // Navigation is filtered for usability only; every page and API enforces its own permission server-side.
  const sections = NAV.map((s) => ({
    section: s.section,
    items: s.items
      .filter((i) => i.anyOf.some((p) => principal.permissions.has(p)))
      .map(({ href, label, icon }) => ({ href, label, icon })),
  })).filter((s) => s.items.length > 0);

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col">
        <DemoBanner />
        <div className="flex flex-1">
          <Sidebar sections={sections} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar name={principal.user.displayName} email={principal.user.email} roles={principal.roles.map((r) => r.name)} />
            <MobileNav sections={sections} />
            <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
            <footer className="border-t border-line bg-white px-6 py-3 text-xs text-muted">
              CAPS demonstration application · All applicant, institution and sample staff records are fictional · Identity and access by Fixiam (Seamfix)
            </footer>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
