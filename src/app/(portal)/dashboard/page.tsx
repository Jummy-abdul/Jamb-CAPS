import Link from "next/link";
import type { Metadata } from "next";
import { FileText, SearchCheck, Award, Hourglass, Building2, ShieldAlert, UserCheck, UsersRound, MonitorSmartphone } from "lucide-react";
import { getPrincipalResult, can } from "@/lib/authz/principal";
import { redirect } from "next/navigation";
import { getDashboardStats, getRecentAdmissionActivity } from "@/lib/data/admissions";
import { getIdentityCounts } from "@/lib/data/identity";
import { listAuditLogs } from "@/lib/data/logs";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, OutcomeBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { relativeTime, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const result = await getPrincipalResult();
  if (!result.ok) redirect(`/login?reason=${result.reason}`);
  const p = result.principal;

  // Authenticated through Fixiam, but no CAPS role has been assigned (no mapped application role or group membership).
  if (!can(p, "dashboard.view")) {
    return (
      <Card className="mx-auto mt-8 max-w-2xl">
        <EmptyState
          icon={ShieldAlert}
          title={`Welcome, ${p.user.displayName}`}
          description="You are signed in through Fixiam and your CAPS account is active, but no CAPS application role is currently assigned to you. Ask your Fixiam administrator to assign you an application role for eFacility."
        >
          <p className="text-xs text-muted">Access in CAPS is granted exclusively through Fixiam-provisioned application role assignments (or mapped group membership).</p>
        </EmptyState>
      </Card>
    );
  }

  const [stats, activity, identity, audit] = await Promise.all([
    getDashboardStats(),
    getRecentAdmissionActivity(8),
    can(p, "users.view") ? getIdentityCounts() : Promise.resolve(null),
    can(p, "audit.view") ? listAuditLogs({ page: 1, pageSize: 8 }) : Promise.resolve(null),
  ]);
  const maxInst = Math.max(1, ...stats.byInstitution.map((i) => i.total));

  return (
    <>
      <PageHeader eyebrow="2026/2027 admission exercise" title={`Good day, ${p.user.displayName.split(" ")[0]}`} description="Overview of admission applications across participating institutions." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total applicants" value={stats.total} icon={FileText} hint="All applications this session" />
        <StatCard label="Under review" value={stats.underReview} icon={SearchCheck} tone="violet" hint="Submitted or in review" />
        <StatCard label="Offers issued" value={stats.offers} icon={Award} tone="green" hint="Admission approved" />
        <StatCard label="Pending decisions" value={stats.pendingDecisions} icon={Hourglass} tone="amber" hint="Reviewed or on hold" />
        <StatCard label="Institutions" value={stats.institutions} icon={Building2} tone="sky" hint="Participating institutions" />
      </div>

      {identity && (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <StatCard label="Fixiam-provisioned users" value={identity.scimUsers} icon={UserCheck} tone="green" hint={`${identity.scimActive} active · provisioned over SCIM`} />
          <StatCard label="Groups" value={identity.groups} icon={UsersRound} hint="Synchronised with Fixiam" />
          <StatCard label="Active sessions" value={identity.activeSessions} icon={MonitorSmartphone} tone="violet" hint="Fixiam SSO sessions" />
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recent admission activity" description="Latest reviews and decisions" action={can(p, "applicants.view") ? <Link href="/applicants" className="text-xs font-medium text-navy-600 hover:underline">View applicants</Link> : undefined} />
          {activity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="divide-y divide-line">
              {activity.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">
                      <span className="font-medium">{a.actor}</span>{" "}
                      {a.kind === "review" ? "reviewed" : a.detail === "approved" ? "approved admission for" : a.detail === "rejected" ? "rejected" : "placed on hold"}{" "}
                      <Link href={`/applicants/${a.applicationId}`} className="font-medium text-navy-700 hover:underline">{a.applicant}</Link>
                    </p>
                    <p className="text-xs text-muted">
                      {a.applicationNo}
                      {a.kind === "review" && a.detail ? ` · ${humanize(a.detail)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {a.isSample ? <Badge tone="gray">Sample</Badge> : <Badge tone="green">Live</Badge>}
                    <span className="text-xs text-muted">{relativeTime(a.at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Applications by institution" />
          <ul className="space-y-3 px-5 py-4">
            {stats.byInstitution.map((i) => (
              <li key={i.code}>
                <div className="flex justify-between text-xs">
                  <span className="truncate pr-2 text-ink" title={i.name}>{i.name}</span>
                  <span className="tabular-nums text-muted">{i.total}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-navy-50">
                  <div className="h-full rounded-full bg-navy-600" style={{ width: `${(i.total / maxInst) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {audit && (
        <Card className="mt-6">
          <CardHeader title="Recent identity & access events" description="From the CAPS audit log" action={<Link href="/audit" className="text-xs font-medium text-navy-600 hover:underline">Open audit log</Link>} />
          {audit.rows.length === 0 ? (
            <EmptyState title="No audit events yet" description="Events appear here when Fixiam provisions users or users sign in." />
          ) : (
            <ul className="divide-y divide-line">
              {audit.rows.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate"><span className="font-mono text-xs text-navy-700">{e.action}</span> <span className="text-muted">·</span> {e.targetLabel ?? "—"}</p>
                    <p className="text-xs text-muted">by {e.actorLabel}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2"><OutcomeBadge outcome={e.outcome} /><span className="text-xs text-muted">{relativeTime(e.occurredAt)}</span></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
