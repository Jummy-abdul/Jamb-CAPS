import type { Metadata } from "next";
import { requirePage } from "@/lib/authz/principal";
import { listApplications, listInstitutions } from "@/lib/data/admissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filters";
import { APPLICATION_STATUSES } from "@/components/ui/badge";
import { ApplicationsTable } from "@/components/admissions/applications-table";
import { pageParam, sp } from "@/lib/utils";

export const metadata: Metadata = { title: "Applicants" };

export default async function ApplicantsPage({ searchParams }: PageProps<"/applicants">) {
  await requirePage("applicants.view", "/applicants");
  const s = await searchParams;
  const q = sp(s.q), status = sp(s.status), institution = sp(s.institution), page = pageParam(s.page);
  const [{ rows, total, pageSize }, insts] = await Promise.all([listApplications({ q, status, institution, page }), listInstitutions()]);
  return (
    <>
      <PageHeader title="Applicants" description="Search and filter admission applicants across participating institutions." />
      <Card>
        <FilterBar
          basePath="/applicants"
          q={q}
          placeholder="Search by name, application no., registration no., email or programme"
          selects={[
            { name: "status", label: "Status", value: status, options: APPLICATION_STATUSES },
            { name: "institution", label: "Institution", value: institution, options: insts.map((i) => ({ value: i.code, label: i.name })) },
          ]}
        />
        <ApplicationsTable rows={rows} total={total} page={page} pageSize={pageSize} basePath="/applicants" params={{ q, status, institution }} />
      </Card>
    </>
  );
}
