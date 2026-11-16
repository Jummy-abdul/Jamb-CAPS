import type { Metadata } from "next";
import { requirePage } from "@/lib/authz/principal";
import { listApplications } from "@/lib/data/admissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filters";
import { ApplicationsTable } from "@/components/admissions/applications-table";
import { pageParam, sp } from "@/lib/utils";

export const metadata: Metadata = { title: "Application Review" };

export default async function ReviewsPage({ searchParams }: PageProps<"/reviews">) {
  await requirePage("applications.review", "/reviews");
  const s = await searchParams;
  const q = sp(s.q), status = sp(s.status), page = pageParam(s.page);
  const filter = status === "submitted" || status === "under_review" ? [status] as const : (["submitted", "under_review"] as const);
  const { rows, total, pageSize } = await listApplications({ q, statuses: [...filter], page });
  return (
    <>
      <PageHeader title="Application Review" description="Applications awaiting review. Open an application to review submitted information, record a recommendation and add review notes." />
      <Card>
        <FilterBar basePath="/reviews" q={q} placeholder="Search applications awaiting review" selects={[{ name: "status", label: "Queue", value: status, options: [{ value: "submitted", label: "Not started" }, { value: "under_review", label: "In review" }] }]} />
        <ApplicationsTable rows={rows} total={total} page={page} pageSize={pageSize} basePath="/reviews" params={{ q, status }} />
      </Card>
    </>
  );
}
