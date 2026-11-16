import type { Metadata } from "next";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { CheckCircle2, XCircle } from "lucide-react";
import { requirePage } from "@/lib/authz/principal";
import { getConfigStatus } from "@/lib/env";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DiscoveryCheck } from "@/components/settings/discovery-check";

export const metadata: Metadata = { title: "Integration Settings" };

function Status({ ok, missing }: { ok: boolean; missing: string[] }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="size-4" />Configured</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-sm text-rose-700"><XCircle className="size-4" />Missing: {missing.join(", ")}</span>
  );
}

function Item({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[220px_1fr]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={mono ? "break-all font-mono text-xs leading-5 text-ink" : "text-sm text-ink"}>{value}</dd>
    </div>
  );
}

export default async function SettingsPage() {
  await requirePage("settings.manage", "/settings");
  const status = getConfigStatus();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = `${proto}://${host}`;
  const scimFingerprint = process.env.SCIM_TOKEN ? createHash("sha256").update(process.env.SCIM_TOKEN).digest("hex").slice(0, 12) : null;

  return (
    <>
      <PageHeader title="Integration Settings" description="Fixiam OIDC and SCIM configuration for this CAPS deployment. Secrets are held in server-side environment variables and are never displayed." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Fixiam Single Sign-On (OIDC)" description="Authorization Code Flow with PKCE" action={<Status ok={status.oidc.configured} missing={status.oidc.missing} />} />
          <dl className="divide-y divide-line px-5 py-2">
            <Item label="Issuer" value={process.env.FIXIAM_ISSUER_URL || "—"} />
            <Item label="Client ID" value={process.env.FIXIAM_CLIENT_ID || "—"} />
            <Item label="Client secret" value={process.env.FIXIAM_CLIENT_SECRET ? <Badge tone="green">Set (hidden)</Badge> : <Badge tone="red">Not set</Badge>} mono={false} />
            <Item label="Redirect URI (register in Fixiam)" value={process.env.FIXIAM_REDIRECT_URI || `${base}/api/auth/callback`} />
            <Item label="Post-logout redirect URI" value={process.env.FIXIAM_POST_LOGOUT_REDIRECT_URI || `${base}/login`} />
            <Item label="Scopes" value={process.env.FIXIAM_SCOPES || "openid profile email"} />
            <Item label="Token endpoint auth" value={process.env.FIXIAM_TOKEN_AUTH_METHOD || "client_secret_basic"} />
          </dl>
          <div className="border-t border-line px-5 py-4"><DiscoveryCheck /></div>
        </Card>

        <Card>
          <CardHeader title="Fixiam Provisioning (SCIM 2.0)" description="CAPS acts as the SCIM service provider" action={<Status ok={status.scim.configured} missing={status.scim.missing} />} />
          <dl className="divide-y divide-line px-5 py-2">
            <Item label="SCIM base URL (Tenant URL)" value={`${base}/scim/v2`} />
            <Item label="Authentication" value="HTTP Bearer token (Authorization: Bearer …)" mono={false} />
            <Item label="Bearer token" value={scimFingerprint ? <span>Set (hidden) · fingerprint <span className="font-mono">sha256:{scimFingerprint}…</span></span> : <Badge tone="red">Not set</Badge>} mono={false} />
            <Item label="Users endpoint" value={`${base}/scim/v2/Users`} />
            <Item label="Groups endpoint" value={`${base}/scim/v2/Groups`} />
            <Item label="Discovery" value={`${base}/scim/v2/ServiceProviderConfig`} />
            <Item label="Supported" value="Users & Groups CRUD, PATCH, filtering (eq, ne, co, sw, ew, pr, gt, ge, lt, le, and, or, not), pagination" mono={false} />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Sessions" />
          <dl className="divide-y divide-line px-5 py-2">
            <Item label="Absolute lifetime" value={`${process.env.SESSION_MAX_AGE_MINUTES || 480} minutes`} mono={false} />
            <Item label="Idle timeout" value={`${process.env.SESSION_IDLE_TIMEOUT_MINUTES || 60} minutes`} mono={false} />
            <Item label="Revalidation" value="Every request re-checks session, account status and effective permissions" mono={false} />
            <Item label="Session secret" value={<Status ok={status.session.configured} missing={status.session.missing} />} mono={false} />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Database" />
          <dl className="divide-y divide-line px-5 py-2">
            <Item label="Supabase PostgreSQL" value={<Status ok={status.database.configured} missing={status.database.missing} />} mono={false} />
            <Item label="Access" value="Server-side only via Drizzle ORM; Row Level Security denies Supabase public API roles" mono={false} />
          </dl>
        </Card>
      </div>
    </>
  );
}
