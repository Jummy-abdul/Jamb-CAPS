import { scimHandler } from "@/lib/scim/handler";
import { resourceTypes } from "@/lib/scim/discovery";

export const dynamic = "force-dynamic";
export const GET = scimHandler(null, "discovery", async ({ baseUrl }) => ({ status: 200, body: resourceTypes(baseUrl), summary: "Resource types" }));
