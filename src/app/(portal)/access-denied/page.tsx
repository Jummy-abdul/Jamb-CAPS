import Link from "next/link";
import type { Metadata } from "next";
import { ShieldX } from "lucide-react";
import { requirePage } from "@/lib/authz/principal";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";
import { sp } from "@/lib/utils";

export const metadata: Metadata = { title: "Access denied" };

export default async function AccessDeniedPage({ searchParams }: PageProps<"/access-denied">) {
  const p = await requirePage();
  const permission = sp((await searchParams).permission);
  return (
    <Card className="mx-auto mt-8 max-w-2xl">
      <EmptyState icon={ShieldX} title="Access denied" description="Your current CAPS role does not permit this action. Roles are assigned centrally in Fixiam; this attempt has been recorded in the audit log.">
        <div className="space-y-3 text-sm">
          {permission && <p>Required permission: <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">{permission}</span></p>}
          <p className="text-muted">Your roles: {p.roles.length ? p.roles.map((r) => r.name).join(", ") : "none assigned"}</p>
          <Link href="/dashboard" className={buttonClass("secondary")}>Back to dashboard</Link>
        </div>
      </EmptyState>
    </Card>
  );
}
