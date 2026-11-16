import type { Metadata } from "next";
import { getPrincipalResult, can } from "@/lib/authz/principal";
import { requirePage } from "@/lib/authz/principal";
import { listApplications } from "@/lib/data/admissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filters";
import { ApplicationsTable } from "@/components/admissions/applications-table";
import { pageParam, sp } from "@/lib/utils";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Admission Decisions" };

export default async function DecisionsPage({ searchParams }: PageProps<"/decisions">) {
  const r = await getPrincipalResult();
  if (!r.ok) redirect(`/login?reason=${r.reason}`);
  // Any decision permission grants access to the decision queue.
  const perm = (["admissions.approve", "admissions.reject", "admissions.hold"] as const).find((x) => can(r.principal, x)) ?? "admissions.approve";
  await requirePage(perm, "/decisions");
  const s = await searchParams;
  const q = sp(s.q), status = sp(s.status), page = pageParam(s.page);
  const valid = ["reviewed", "on_hold", "admitted", "rejected"] as const;
  const statuses = valid.includes(status as never) ? [status as (typeof valid)[number]] : (["reviewed", "on_hold"] as const);
  const { rows, total, pageSize } = await listApplications({ q, statuses: [...statuses], page });
  return (
    <>
      <PageHeader title="Admission Decisions" description="Reviewed applications awaiting a decision. Open an application to approve, reject or place it on hold." />
      <Card>
        <FilterBar
          basePath="/decisions"
          q={q}
          placeholder="Search applications"
          selects={[{ name: "status", label: "Queue", value: status, options: [
            { value: "reviewed", label: "Awaiting decision" }, { value: "on_hold", label: "On hold" },
            { value: "admitted", label: "Admitted" }, { value: "rejected", label: "Rejected" },
          ] }]}
        />
        <ApplicationsTable rows={rows} total={total} page={page} pageSize={pageSize} basePath="/decisions" params={{ q, status }} />
      </Card>
    </>
  );
}
