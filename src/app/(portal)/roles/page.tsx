import type { Metadata } from "next";
import { Check, Minus, Info } from "lucide-react";
import { requirePage, can } from "@/lib/authz/principal";
import { getRolesAndMappings } from "@/lib/data/identity";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, THead, Th, TBody, Tr, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AddMappingButton, ToggleMappingButton } from "@/components/access/mapping-editor";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Role & Permission Mapping" };

export default async function RolesPage() {
  const p = await requirePage("access.view", "/roles");
  const { roles, permissions, matrix, mappings, assignmentCounts } = await getRolesAndMappings();
  const canManage = can(p, "access.manage");

  return (
    <>
      <PageHeader title="Role & Permission Mapping" description="CAPS application roles, the permissions each role grants, and how Fixiam-synchronised groups map onto those roles." />

      <div className="grid gap-4 lg:grid-cols-3">
        {roles.map((r) => (
          <Card key={r.key} className="p-5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-ink">{r.name}</h3>
              <Badge tone="navy">{assignmentCounts[r.key] ?? 0} user(s)</Badge>
            </div>
            <p className="mt-2 text-sm text-muted">{r.description}</p>
            <p className="mt-3 font-mono text-[11px] text-muted">{r.key}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Role mappings"
          description="Configurable. A user receives a CAPS role from a Fixiam-provisioned application role, or while they are a member of a matching Fixiam group."
          action={canManage ? <AddMappingButton roles={roles.map((r) => ({ key: r.key, name: r.name }))} /> : undefined}
        />
        <div className="flex items-start gap-2 border-b border-line bg-slate-50 px-5 py-3 text-xs text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Fixiam owns application-role assignments and group membership and provisions them over SCIM; CAPS owns only this mapping of an external application role (or group) onto an internal role. Application roles arrive on the SCIM User (the <code>roles</code> attribute and the Fixiam authorization extension). Changing a mapping re-evaluates every affected user immediately and is audited. Administrators cannot create or change a mapping that would alter their own access.
        </div>
        {mappings.length === 0 ? (
          <EmptyState title="No mappings configured" description="Without mappings, provisioned application roles and group membership grant no CAPS permissions." />
        ) : (
          <Table>
            <THead><tr><Th>Fixiam source</Th><Th>CAPS role</Th><Th className="text-right">Matches</Th><Th>Status</Th><Th>Created</Th>{canManage && <Th />}</tr></THead>
            <TBody>
              {mappings.map(({ m, roleName, matchedGroups }) => (
                <Tr key={m.id}>
                  <Td>
                    <p className="font-medium">{m.sourceValue}</p>
                    <p className="text-xs text-muted">{m.sourceType === "application_role" ? "Fixiam application role" : m.sourceType === "group_display_name" ? "Group display name" : "Group externalId"}</p>
                  </Td>
                  <Td><Badge tone="navy">{roleName}</Badge></Td>
                  <Td className="text-right tabular-nums">{matchedGroups}</Td>
                  <Td>{m.enabled ? <Badge tone="green" dot>Enabled</Badge> : <Badge tone="gray" dot>Disabled</Badge>}</Td>
                  <Td className="text-xs text-muted">{formatDateTime(m.createdAt)}<br />by {m.createdBy}</Td>
                  {canManage && <Td className="text-right"><ToggleMappingButton id={m.id} enabled={m.enabled} /></Td>}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Permission matrix" description="Enforced on the server for every page and API request" />
        <Table>
          <THead>
            <tr>
              <Th>Permission</Th>
              {roles.map((r) => <Th key={r.key} className="text-center">{r.name}</Th>)}
            </tr>
          </THead>
          <TBody>
            {permissions.map((perm) => (
              <Tr key={perm.key}>
                <Td>
                  <p className="font-medium">{perm.name}</p>
                  <p className="text-xs text-muted">{perm.description} <span className="font-mono">({perm.key})</span></p>
                </Td>
                {roles.map((r) => (
                  <Td key={r.key} className="text-center">
                    {matrix.has(`${r.key}|${perm.key}`) ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Granted" /> : <Minus className="mx-auto size-4 text-slate-300" aria-label="Not granted" />}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
