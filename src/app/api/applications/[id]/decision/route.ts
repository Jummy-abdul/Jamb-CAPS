import { z } from "zod";
import { requireApi, clientIp } from "@/lib/authz/principal";
import { DECISION_PERMISSION } from "@/lib/authz/permissions";
import { recordDecision, ActionError } from "@/lib/data/admission-actions";

const Body = z.object({
  decision: z.enum(["approved", "rejected", "on_hold"]),
  reason: z.string().trim().max(1000).optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/applications/[id]/decision">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid decision" }, { status: 400 });
  const { decision, reason } = parsed.data;

  // Each decision type is protected by its own permission, enforced here on the server.
  const auth = await requireApi(req, DECISION_PERMISSION[decision], `/api/applications/${id}/decision`);
  if (!auth.ok) return auth.response;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Application not found" }, { status: 404 });
  if (decision !== "approved" && (!reason || reason.length < 3)) {
    return Response.json({ error: "A reason is required to reject or hold an application." }, { status: 400 });
  }
  try {
    return Response.json(await recordDecision(auth.principal, id, decision, reason, clientIp(req.headers)));
  } catch (e) {
    if (e instanceof ActionError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[decision] failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Unexpected error" }, { status: 500 });
  }
}
