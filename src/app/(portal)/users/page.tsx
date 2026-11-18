import Link from "next/link";
import type { Metadata } from "next";
import { Contact, Info } from "lucide-react";
import { requirePage } from "@/lib/authz/principal";
import { listUsers, PAGE_SIZE } from "@/lib/data/identity";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filters";
import { Table, THead, Th, TBody, Tr, Td, Pagination } from "@/components/ui/table";
import { ActiveBadge, Badge, SourceBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, pageParam, relativeTime, sp } from "@/lib/utils";

export const metadata: Metadata = { title: "User Directory" };

export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  await requirePage("users.view", "/users");
  const s = await searchParams;
  const q = sp(s.q), source = sp(s.source), status = sp(s.status), page = pageParam(s.page);
  const { rows, total, counts } = await listUsers({ q, source, status, page });

  return (
    <>
      <PageHeader
        title="User Directory"
        description="Users provisioned into CAPS by Fixiam over SCIM 2.0. Accounts are created, updated and deactivated in Fixiam — not in CAPS."
        actions={
          <div className="flex gap-2 text-xs">
            <Badge tone="green">{counts.scim ?? 0} provisioned by Fixiam</Badge>
            <Badge tone="gray">{counts.sample ?? 0} sample records</Badge>
          </div>
        }
      />
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-navy-100 bg-navy-50 px-4 py-3 text-sm text-navy-800">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          <b>Fixiam · SCIM</b> users were provisioned by Fixiam and can sign in through Fixiam SSO.{" "}
          <b>Sample records</b> are fictional demonstration staff seeded locally; they were not provisioned by Fixiam and cannot sign in.
        </p>
      </div>
      <Card>
        <FilterBar
          basePath="/users"
          q={q}
          placeholder="Search by name, username, email or department"
          selects={[
            { name: "source", label: "Source", value: source, options: [{ value: "scim", label: "Fixiam · SCIM" }, { value: "sample", label: "Sample records" }] },
            { name: "status", label: "Status", value: status, options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Deactivated" }, { value: "deprovisioned", label: "Deprovisioned" }] },
          ]}
        />
        {rows.length === 0 ? (
          <EmptyState icon={Contact} title={q || source || status ? "No users match your filters" : "No users yet"} description="Users appear here automatically when Fixiam provisions them to CAPS over SCIM." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Full name</Th>
                  <Th>Username</Th>
                  <Th>Department</Th>
                  <Th>Application role</Th>
                  <Th>Status</Th>
                  <Th>Provisioning source</Th>
                  <Th>Last synchronised</Th>
                </tr>
              </THead>
              <TBody>
                {rows.map((u) => {
                  const name = u.displayName || [u.givenName, u.familyName].filter(Boolean).join(" ") || u.userName;
                  return (
                    <Tr key={u.id} className={u.source === "sample" ? "bg-slate-50/40" : undefined}>
                      <Td>
                        <Link href={`/users/${u.id}`} className="font-medium hover:text-navy-700">{name}</Link>
                        <p className="text-xs text-muted">{u.email ?? "—"}</p>
                      </Td>
                      <Td className="font-mono text-xs">{u.userName}</Td>
                      <Td>{u.department ?? "—"}<p className="text-xs text-muted">{u.title ?? ""}</p></Td>
                      <Td>
                        {u.source === "sample" ? (
                          <span className="text-muted">{u.sampleRoleLabel} <span className="text-xs">(sample)</span></span>
                        ) : u.roles.length ? (
                          <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone="navy">{r}</Badge>)}</div>
                        ) : (
                          <span className="text-xs text-muted">No role assigned</span>
                        )}
                      </Td>
                      <Td><ActiveBadge active={u.active} deleted={!!u.deletedAt} /></Td>
                      <Td><SourceBadge source={u.source} /></Td>
                      <Td className="whitespace-nowrap text-xs text-muted" >
                        {u.source === "scim" ? <span title={formatDateTime(u.lastSyncedAt)}>{relativeTime(u.lastSyncedAt)}</span> : "Not synchronised"}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/users" params={{ q, source, status }} />
          </>
        )}
      </Card>
    </>
  );
}
