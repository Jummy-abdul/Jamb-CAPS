import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requirePage } from "@/lib/authz/principal";
import { getGroupDetail } from "@/lib/data/identity";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, THead, Th, TBody, Tr, Td } from "@/components/ui/table";
import { ActiveBadge, Badge, SourceBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Group" };

export default async function GroupDetailPage({ params }: PageProps<"/groups/[id]">) {
  const { id } = await params;
  await requirePage("access.view", `/groups/${id}`);
  const data = await getGroupDetail(id);
  if (!data) notFound();
  const { group, members } = data;
  return (
    <>
      <Link href="/groups" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Groups & Access</Link>
      <PageHeader title={group.displayName} description={group.description ?? undefined} actions={<><SourceBadge source={group.source} />{group.deletedAt && <Badge tone="red">Deleted in Fixiam</Badge>}</>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Group details" />
          <dl className="space-y-3 px-5 py-4 text-sm">
            <div><dt className="text-xs text-muted">SCIM id</dt><dd className="font-mono text-xs">{group.id}</dd></div>
            <div><dt className="text-xs text-muted">External id</dt><dd className="font-mono text-xs">{group.externalId ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted">Mapped CAPS roles</dt><dd className="mt-1">{group.mappedRoles.length ? group.mappedRoles.map((r) => <Badge key={r} tone="navy" className="mr-1">{r}</Badge>) : <span className="text-muted">None — membership grants no permissions</span>}</dd></div>
            <div><dt className="text-xs text-muted">Created in CAPS</dt><dd>{formatDateTime(group.createdAt)}</dd></div>
            <div><dt className="text-xs text-muted">Last synchronised</dt><dd>{formatDateTime(group.lastSyncedAt)}</dd></div>
          </dl>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Members" description={`${members.length} member(s), synchronised from Fixiam`} />
          {members.length === 0 ? (
            <EmptyState title="No members" description="Assign users to this group in Fixiam." />
          ) : (
            <Table>
              <THead><tr><Th>Name</Th><Th>Username</Th><Th>Account</Th><Th>Member since</Th></tr></THead>
              <TBody>
                {members.map((m) => (
                  <Tr key={m.id}>
                    <Td><Link href={`/users/${m.id}`} className="font-medium hover:text-navy-700">{m.displayName ?? m.userName}</Link><p className="text-xs text-muted">{m.email}</p></Td>
                    <Td className="font-mono text-xs">{m.userName}</Td>
                    <Td><ActiveBadge active={m.active} deleted={!!m.deletedAt} /></Td>
                    <Td className="text-xs text-muted">{formatDateTime(m.addedAt)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
