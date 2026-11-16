import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requirePage, can } from "@/lib/authz/principal";
import { getUserDetail } from "@/lib/data/identity";
import { listAuditLogs } from "@/lib/data/logs";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { ActiveBadge, Badge, OutcomeBadge, SourceBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, Th, TBody, Tr, Td } from "@/components/ui/table";
import { formatDateTime, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "User" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

export default async function UserDetailPage({ params }: PageProps<"/users/[id]">) {
  const { id } = await params;
  const p = await requirePage("users.view", `/users/${id}`);
  const data = await getUserDetail(id);
  if (!data) notFound();
  const { user, memberships, entitlements, sessions } = data;
  const name = user.displayName || [user.givenName, user.familyName].filter(Boolean).join(" ") || user.userName;
  const activeRoles = entitlements.filter((e) => !e.e.revokedAt);
  const history = can(p, "audit.view") ? await listAuditLogs({ target: user.id, page: 1, pageSize: 15 }) : null;

  return (
    <>
      <Link href="/users" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />User Directory</Link>
      <PageHeader title={name} description={user.email ?? user.userName} actions={<><SourceBadge source={user.provisioningSource} /><ActiveBadge active={user.active} deleted={!!user.deletedAt} /></>} />

      {user.provisioningSource === "sample" && (
        <div className="mb-6 rounded-lg border border-line bg-slate-50 px-4 py-3 text-sm text-muted">
          This is a fictional <b>sample record</b> seeded for demonstration. It was not provisioned by Fixiam, holds no CAPS entitlements and cannot sign in.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Identity attributes" description="As received from Fixiam" />
          <dl className="divide-y divide-line px-5 py-2">
            <Row label="Username"><span className="font-mono text-xs">{user.userName}</span></Row>
            <Row label="Given name">{user.givenName ?? "—"}</Row>
            <Row label="Family name">{user.familyName ?? "—"}</Row>
            <Row label="Title">{user.title ?? "—"}</Row>
            <Row label="Department">{user.department ?? "—"}</Row>
            <Row label="SCIM id"><span className="font-mono text-[11px]">{user.id}</span></Row>
            <Row label="External id"><span className="font-mono text-[11px]">{user.externalId ?? "—"}</span></Row>
            <Row label="Fixiam subject (sub)"><span className="font-mono text-[11px]">{user.fixiamSub ?? "Not yet linked (no sign-in)"}</span></Row>
            <Row label="Provisioned">{formatDateTime(user.createdAt)}</Row>
            <Row label="Last synchronised">{formatDateTime(user.lastSyncedAt)}</Row>
            <Row label="Last sign-in">{formatDateTime(user.lastLoginAt)}</Row>
            {user.deactivatedAt && <Row label="Deactivated">{formatDateTime(user.deactivatedAt)}</Row>}
            {user.deletedAt && <Row label="Deprovisioned">{formatDateTime(user.deletedAt)}</Row>}
          </dl>
        </Card>

        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Group memberships" description="Synchronised from Fixiam" />
            {memberships.length === 0 ? (
              <EmptyState title="Not a member of any group" description="Group memberships are assigned in Fixiam." />
            ) : (
              <ul className="divide-y divide-line">
                {memberships.map((m) => (
                  <li key={m.groupId} className="flex items-center justify-between px-5 py-3 text-sm">
                    <Link href={`/groups/${m.groupId}`} className="font-medium hover:text-navy-700">{m.name}</Link>
                    <span className="text-xs text-muted">since {formatDateTime(m.addedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Effective roles & entitlement history" description={`${activeRoles.length} active grant(s)`} />
            {entitlements.length === 0 ? (
              <EmptyState title="No role has ever been granted" />
            ) : (
              <Table>
                <THead><tr><Th>Role</Th><Th>Granted via group</Th><Th>Granted</Th><Th>Status</Th></tr></THead>
                <TBody>
                  {entitlements.map(({ e, roleName }) => (
                    <Tr key={e.id}>
                      <Td className="font-medium">{roleName}</Td>
                      <Td>{e.sourceGroupName ?? "—"}</Td>
                      <Td className="text-xs text-muted">{formatDateTime(e.grantedAt)}</Td>
                      <Td>{e.revokedAt ? <span className="text-xs"><Badge tone="red">Revoked</Badge> <span className="text-muted">{formatDateTime(e.revokedAt)} · {e.revokeReason}</span></span> : <Badge tone="green" dot>Active</Badge>}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Sessions" description="Fixiam SSO sessions in CAPS" />
            {sessions.length === 0 ? (
              <EmptyState title="No sessions" />
            ) : (
              <Table>
                <THead><tr><Th>Started</Th><Th>Last seen</Th><Th>Expires</Th><Th>Status</Th></tr></THead>
                <TBody>
                  {sessions.map((s) => (
                    <Tr key={s.id}>
                      <Td className="text-xs">{formatDateTime(s.createdAt)}</Td>
                      <Td className="text-xs">{formatDateTime(s.lastSeenAt)}</Td>
                      <Td className="text-xs">{formatDateTime(s.expiresAt)}</Td>
                      <Td>{s.revokedAt ? <Badge tone="red">Revoked · {humanize(s.revokeReason ?? "")}</Badge> : s.expiresAt < new Date() ? <Badge tone="gray">Expired</Badge> : <Badge tone="green" dot>Active</Badge>}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          {history && (
            <Card>
              <CardHeader title="Identity & access history" action={<Link className="text-xs font-medium text-navy-600 hover:underline" href={`/audit?target=${user.id}`}>Full history</Link>} />
              {history.rows.length === 0 ? <EmptyState title="No events" /> : (
                <ul className="divide-y divide-line">
                  {history.rows.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm">
                      <div><span className="font-mono text-xs text-navy-700">{e.action}</span> <span className="text-xs text-muted">by {e.actorLabel}</span></div>
                      <div className="flex items-center gap-2"><OutcomeBadge outcome={e.outcome} /><span className="whitespace-nowrap text-xs text-muted">{formatDateTime(e.occurredAt)}</span></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
