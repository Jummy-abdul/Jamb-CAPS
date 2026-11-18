import { getConfigStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness + non-secret configuration status. Never returns secret values. */
export async function GET() {
  const status = getConfigStatus();
  return Response.json({
    status: "ok",
    service: "caps",
    integrations: Object.fromEntries(Object.entries(status).map(([k, v]) => [k, v.configured])),
    time: new Date().toISOString(),
  });
}
