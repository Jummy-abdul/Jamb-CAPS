import { z } from "zod";
import { requireApi, clientIp } from "@/lib/authz/principal";
import { createMapping, MappingError } from "@/lib/authz/mappings";

const Body = z.object({
  sourceType: z.enum(["group_display_name", "group_external_id"]),
  sourceValue: z.string().trim().min(1).max(256),
  roleKey: z.string().trim().min(1).max(64),
  description: z.string().trim().max(256).optional(),
});

export async function POST(req: Request) {
  const auth = await requireApi(req, "access.manage", "/api/admin/role-mappings");
  if (!auth.ok) return auth.response;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid mapping" }, { status: 400 });
  try {
    const r = await createMapping(auth.principal, parsed.data, clientIp(req.headers));
    return Response.json(r, { status: 201 });
  } catch (e) {
    if (e instanceof MappingError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[role-mappings] create failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Unexpected error" }, { status: 500 });
  }
}
