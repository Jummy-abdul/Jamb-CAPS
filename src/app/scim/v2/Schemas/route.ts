import { scimHandler } from "@/lib/scim/handler";
import { schemas } from "@/lib/scim/discovery";

export const dynamic = "force-dynamic";
export const GET = scimHandler(null, "discovery", async ({ baseUrl }) => ({ status: 200, body: schemas(baseUrl), summary: "Schemas" }));
