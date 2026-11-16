import { scimHandler, pagination, project } from "@/lib/scim/handler";
import { createGroup, listGroups } from "@/lib/scim/groups";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/scim/constants";

export const dynamic = "force-dynamic";

/** Used by Fixiam "Manage Groups" to discover existing CAPS groups for import. */
export const GET = scimHandler("Group", "list", async ({ url, baseUrl }) => {
  const { startIndex, count } = pagination(url, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const list = await listGroups(url, startIndex, count, baseUrl);
  const filter = url.searchParams.get("filter");
  return {
    status: 200,
    body: { ...list, Resources: list.Resources.map((r) => project(r, url)) },
    summary: `Listed groups${filter ? ` (filter: ${filter})` : ""}: ${list.itemsPerPage} of ${list.totalResults}`,
  };
});

export const POST = scimHandler("Group", "create", async ({ body, baseUrl, ip }) => {
  const r = await createGroup(body, baseUrl, ip);
  const meta = r.resource.meta as { location: string; version: string };
  return { status: 201, body: r.resource, headers: { Location: meta.location, ETag: meta.version }, resourceId: r.id, summary: r.summary };
});
