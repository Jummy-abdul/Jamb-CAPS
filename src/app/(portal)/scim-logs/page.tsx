import type { Metadata } from "next";
import { RefreshCw } from "lucide-react";
import { requirePage } from "@/lib/authz/principal";
import { listScimLogs, LOG_PAGE_SIZE } from "@/lib/data/logs";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filters";
import { Table, THead, Th, TBody, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge, HttpStatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { JsonDetails } from "@/components/ui/json-details";
import { formatDateTime, pageParam, sp } from "@/lib/utils";

export const metadata: Metadata = { title: "SCIM Sync Logs" };

export default async function ScimLogsPage({ searchParams }: PageProps<"/scim-logs">) {
  await requirePage("scim.logs.view", "/scim-logs");
  const s = await searchParams;
  const q = sp(s.q), resource = sp(s.resource), result = sp(s.result), page = pageParam(s.page);
  const { rows, total } = await listScimLogs({ q, resource, result, page });
  return (
    <>
      <PageHeader title="SCIM Synchronisation Logs" description="Every SCIM 2.0 request received from Fixiam at /scim/v2 — including rejected and failed requests. Credentials and sensitive attributes are never logged." />
      <Card>
        <FilterBar
          basePath="/scim-logs"
          q={q}
          placeholder="Search summary, path or resource id"
          selects={[
            { name: "resource", label: "Resource", value: resource, options: [{ value: "User", label: "Users" }, { value: "Group", label: "Groups" }] },
            { name: "result", label: "Result", value: result, options: [{ value: "ok", label: "Successful" }, { value: "error", label: "Errors" }] },
          ]}
        />
        {rows.length === 0 ? (
          <EmptyState icon={RefreshCw} title="No SCIM traffic yet" description="Requests appear here as soon as Fixiam calls the CAPS SCIM endpoint." />
        ) : (
          <>
            <Table>
              <THead><tr><Th>Time</Th><Th>Request</Th><Th>Operation</Th><Th>Status</Th><Th>Summary</Th><Th className="text-right">Duration</Th><Th>Payload</Th></tr></THead>
              <TBody>
                {rows.map((l) => (
                  <Tr key={l.id}>
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(l.occurredAt)}</Td>
                    <Td className="max-w-[340px] break-all font-mono text-xs"><b>{l.method}</b> {l.path}{l.query ? <span className="text-muted">?{l.query}</span> : null}</Td>
                    <Td><Badge tone="navy">{l.operation}</Badge></Td>
                    <Td><HttpStatusBadge code={l.statusCode} /></Td>
                    <Td className="max-w-[320px]"><p className="text-sm">{l.summary}</p>{l.errorDetail && <p className="text-xs text-rose-700">{l.errorDetail}</p>}</Td>
                    <Td className="text-right text-xs tabular-nums text-muted">{l.durationMs} ms</Td>
                    <Td><JsonDetails value={l.requestBody} label="Request body" /></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={LOG_PAGE_SIZE} total={total} basePath="/scim-logs" params={{ q, resource, result }} />
          </>
        )}
      </Card>
    </>
  );
}
