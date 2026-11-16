import { scimHandler } from "@/lib/scim/handler";
import { serviceProviderConfig } from "@/lib/scim/discovery";

export const dynamic = "force-dynamic";
export const GET = scimHandler(null, "discovery", async ({ baseUrl }) => ({ status: 200, body: serviceProviderConfig(baseUrl), summary: "Service provider configuration" }));
