import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { requirePage } from "@/lib/authz/principal";
import { listAuditLogs, AUDIT_CATEGORIES } from "@/lib/data/logs";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filters";
import { Table, THead, Th, TBody, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge, OutcomeBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { JsonDetails } from "@/components/ui/json-details";
import { formatDateTime, humanize, pageParam, sp } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit Logs" };

const ACTOR_TONE = { fixiam_scim: "green", fixiam_oidc: "green", user: "navy", system: "gray", anonymous: "amber" } as const;

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requirePage("audit.view", "/audit");
  const s = await searchParams;
  const q = sp(s.q), category = sp(s.category), outcome = sp(s.outcome), target = sp(s.target), page = pageParam(s.page);
  const { rows, total, pageSize } = await listAuditLogs({ q, category, outcome, target, page });
  return (
    <>
      <PageHeader title="Audit Logs" description="Append-only record of provisioning, group, role, authentication, session, authorization and admission events." />
      <Card>
        <FilterBar
          basePath="/audit"
          q={q}
          placeholder="Search action, actor or affected user"
          selects={[
            { name: "category", label: "Category", value: category, options: AUDIT_CATEGORIES.map((c) => ({ value: c, label: humanize(c) })) },
            { name: "outcome", label: "Outcome", value: outcome, options: [{ value: "success", label: "Success" }, { value: "denied", label: "Denied" }, { value: "failure", label: "Failure" }] },
          ]}
        />
        {target && <p className="border-b border-line bg-navy-50 px-4 py-2 text-xs text-navy-800">Filtered to events affecting <span className="font-mono">{target}</span></p>}
        {rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="No audit events" description="Events are recorded as Fixiam provisions identities and users work in CAPS." />
        ) : (
          <>
            <Table>
              <THead><tr><Th>Timestamp</Th><Th>Actor</Th><Th>Action</Th><Th>Affected</Th><Th>Outcome</Th><Th>Details</Th></tr></THead>
              <TBody>
                {rows.map((e) => (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(e.occurredAt)}</Td>
                    <Td>
                      <p className="text-sm">{e.actorLabel}</p>
                      <Badge tone={ACTOR_TONE[e.actorType]} className="mt-0.5">{humanize(e.actorType)}</Badge>
                    </Td>
                    <Td><p className="font-mono text-xs text-navy-800">{e.action}</p><p className="text-[11px] text-muted">{humanize(e.category)}{e.isSample ? " · sample" : ""}</p></Td>
                    <Td className="max-w-[260px]"><p className="truncate text-sm">{e.targetLabel ?? "—"}</p>{e.targetType && <p className="text-[11px] text-muted">{e.targetType}</p>}</Td>
                    <Td><OutcomeBadge outcome={e.outcome} /></Td>
                    <Td><JsonDetails value={e.details} /></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={pageSize} total={total} basePath="/audit" params={{ q, category, outcome, target }} />
          </>
        )}
      </Card>
    </>
  );
}
