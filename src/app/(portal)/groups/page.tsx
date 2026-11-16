import Link from "next/link";
import type { Metadata } from "next";
import { UsersRound, Info } from "lucide-react";
import { requirePage } from "@/lib/authz/principal";
import { listGroups, getRoleAssignments } from "@/lib/data/identity";
import { listScimLogs } from "@/lib/data/logs";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filters";
import { Table, THead, Th, TBody, Tr, Td } from "@/components/ui/table";
import { ActiveBadge, Badge, HttpStatusBadge, SourceBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, relativeTime, sp } from "@/lib/utils";

export const metadata: Metadata = { title: "Groups & Access" };

export default async function GroupsPage({ searchParams }: PageProps<"/groups">) {
  await requirePage("access.view", "/groups");
  const s = await searchParams;
  const q = sp(s.q);
  const [groups, assignments, sync] = await Promise.all([
    listGroups({ q }),
    getRoleAssignments(),
    listScimLogs({ resource: "Group", page: 1 }),
  ]);

  return (
    <>
      <PageHeader title="Groups & Access" description="Groups are created in Fixiam (or imported by Fixiam from CAPS) and their memberships are synchronised over SCIM. Group membership determines CAPS roles through the configured role mappings." />
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-navy-100 bg-navy-50 px-4 py-3 text-sm text-navy-800">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>Fixiam is the source of truth for group membership. Removing a user from a group in Fixiam removes the permissions that group grants, without deactivating the user&apos;s CAPS account.</p>
      </div>

      <Card>
        <CardHeader title="Groups" description={`${groups.length} group(s)`} />
        <FilterBar basePath="/groups" q={q} placeholder="Search groups" />
        {groups.length === 0 ? (
          <EmptyState icon={UsersRound} title="No groups yet" description="Groups appear here when Fixiam provisions them over SCIM." />
        ) : (
          <Table>
            <THead><tr><Th>Group</Th><Th>Source</Th><Th>Mapped CAPS role(s)</Th><Th className="text-right">Members</Th><Th>Last synchronised</Th></tr></THead>
            <TBody>
              {groups.map((g) => (
                <Tr key={g.id}>
                  <Td>
                    <Link href={`/groups/${g.id}`} className="font-medium hover:text-navy-700">{g.displayName}</Link>
                    {g.externalId && <p className="font-mono text-[11px] text-muted">externalId: {g.externalId}</p>}
                  </Td>
                  <Td><SourceBadge source={g.source} /></Td>
                  <Td>{g.mappedRoles.length ? <div className="flex flex-wrap gap-1">{g.mappedRoles.map((r) => <Badge key={r} tone="navy">{r}</Badge>)}</div> : <span className="text-xs text-muted">Not mapped — grants no permissions</span>}</Td>
                  <Td className="text-right tabular-nums">{g.memberCount}</Td>
                  <Td className="text-xs text-muted">{g.lastSyncedAt ? relativeTime(g.lastSyncedAt) : g.source === "caps_native" ? "Pre-existing in CAPS" : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="User role assignments" description="Active entitlements derived from Fixiam group membership" />
          {assignments.length === 0 ? (
            <EmptyState title="No active role assignments" description="Assign a provisioned user to a mapped group in Fixiam." />
          ) : (
            <Table>
              <THead><tr><Th>User</Th><Th>Role</Th><Th>Via group</Th><Th>Since</Th></tr></THead>
              <TBody>
                {assignments.map((a, i) => (
                  <Tr key={i}>
                    <Td><Link href={`/users/${a.userId}`} className="font-medium hover:text-navy-700">{a.displayName ?? a.userName}</Link> {!a.active && <ActiveBadge active={false} />}</Td>
                    <Td><Badge tone="navy">{a.roleName}</Badge></Td>
                    <Td className="text-xs">{a.viaGroup}</Td>
                    <Td className="text-xs text-muted">{formatDateTime(a.grantedAt)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Group synchronisation history" description="Recent SCIM Group operations from Fixiam" action={<Link href="/scim-logs?resource=Group" className="text-xs font-medium text-navy-600 hover:underline">All SCIM logs</Link>} />
          {sync.rows.length === 0 ? (
            <EmptyState title="No group synchronisation yet" />
          ) : (
            <ul className="divide-y divide-line">
              {sync.rows.slice(0, 10).map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0"><span className="font-mono text-xs">{l.method}</span> <span className="truncate">{l.summary}</span></div>
                  <div className="flex shrink-0 items-center gap-2"><HttpStatusBadge code={l.statusCode} /><span className="text-xs text-muted">{relativeTime(l.occurredAt)}</span></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
