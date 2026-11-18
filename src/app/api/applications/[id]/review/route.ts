import { z } from "zod";
import { requireApi, clientIp } from "@/lib/authz/principal";
import { recordReview, ActionError } from "@/lib/data/admission-actions";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({
    action: z.literal("note"),
    notes: z.string().trim().min(3).max(2000),
    recommendation: z.enum(["recommend_admission", "recommend_rejection", "requires_further_review"]).optional(),
  }),
]);

export async function POST(req: Request, ctx: RouteContext<"/api/applications/[id]/review">) {
  const { id } = await ctx.params;
  const auth = await requireApi(req, "applications.review", `/api/applications/${id}/review`);
  if (!auth.ok) return auth.response;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Application not found" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid review submission", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  try {
    const result = await recordReview(auth.principal, id, parsed.data, clientIp(req.headers));
    return Response.json(result);
  } catch (e) {
    if (e instanceof ActionError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[review] failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Unexpected error" }, { status: 500 });
  }
}
