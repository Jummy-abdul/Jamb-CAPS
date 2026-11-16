import Link from "next/link";
import { Table, THead, Th, TBody, Tr, Td, Pagination } from "@/components/ui/table";
import { ApplicationStatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";
import { FileSearch } from "lucide-react";

type Row = {
  id: string; applicationNo: string; name: string; email: string; institution: string; institutionCode: string;
  programme: string; status: string; submittedAt: Date; utmeScore: number;
};

export function ApplicationsTable({ rows, total, page, pageSize, basePath, params }: { rows: Row[]; total: number; page: number; pageSize: number; basePath: string; params: Record<string, string | undefined> }) {
  if (rows.length === 0) {
    return <EmptyState icon={FileSearch} title="No applications match your filters" description="Try a different search term or clear the filters." />;
  }
  return (
    <>
      <Table>
        <THead>
          <tr>
            <Th>Application no.</Th>
            <Th>Applicant</Th>
            <Th>Institution</Th>
            <Th>Programme</Th>
            <Th className="text-right">UTME</Th>
            <Th>Status</Th>
            <Th>Submitted</Th>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td><Link href={`/applicants/${r.id}`} className="font-mono text-xs font-medium text-navy-700 hover:underline">{r.applicationNo}</Link></Td>
              <Td>
                <Link href={`/applicants/${r.id}`} className="font-medium hover:text-navy-700">{r.name}</Link>
                <p className="text-xs text-muted">{r.email}</p>
              </Td>
              <Td><span title={r.institution} className="block max-w-[220px] truncate">{r.institution}</span><span className="text-xs text-muted">{r.institutionCode}</span></Td>
              <Td className="max-w-[200px] truncate">{r.programme}</Td>
              <Td className="text-right tabular-nums">{r.utmeScore}</Td>
              <Td><ApplicationStatusBadge status={r.status} /></Td>
              <Td className="whitespace-nowrap text-muted">{formatDate(r.submittedAt)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      <Pagination page={page} pageSize={pageSize} total={total} basePath={basePath} params={params} />
    </>
  );
}
