import { requireApi } from "@/lib/authz/principal";
import { describeDiscovery } from "@/lib/auth/oidc";
import { ConfigError } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Fetch and summarise Fixiam's OIDC discovery document (no secrets returned). */
export async function GET(req: Request) {
  const auth = await requireApi(req, "settings.manage", "/api/admin/oidc-check");
  if (!auth.ok) return auth.response;
  try {
    return Response.json({ ok: true, ...(await describeDiscovery()) });
  } catch (e) {
    const msg = e instanceof ConfigError ? e.message : `Could not load the discovery document: ${e instanceof Error ? e.message : "unknown error"}`;
    return Response.json({ ok: false, error: msg }, { status: 200 });
  }
}
