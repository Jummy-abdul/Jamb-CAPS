import { z } from "zod";
import { requireApi, clientIp } from "@/lib/authz/principal";
import { setMappingEnabled, MappingError } from "@/lib/authz/mappings";

export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/role-mappings/[id]">) {
  const { id } = await ctx.params;
  const auth = await requireApi(req, "access.manage", `/api/admin/role-mappings/${id}`);
  if (!auth.ok) return auth.response;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Mapping not found." }, { status: 404 });
  const parsed = z.object({ enabled: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    return Response.json(await setMappingEnabled(auth.principal, id, parsed.data.enabled, clientIp(req.headers)));
  } catch (e) {
    if (e instanceof MappingError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[role-mappings] update failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Unexpected error" }, { status: 500 });
  }
}
