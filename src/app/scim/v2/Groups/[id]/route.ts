import { scimHandler, project } from "@/lib/scim/handler";
import { deleteGroup, getGroup, patchGroup, replaceGroup } from "@/lib/scim/groups";

export const dynamic = "force-dynamic";

const idOf = (url: URL) => decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");

export const GET = scimHandler("Group", "get", async ({ url, baseUrl }) => {
  const id = idOf(url);
  const g = await getGroup(id, url, baseUrl);
  return { status: 200, body: project(g, url), resourceId: id, summary: `Retrieved group '${g.displayName}'` };
});

export const PUT = scimHandler("Group", "replace", async ({ url, body, baseUrl, ip }) => {
  const id = idOf(url);
  const r = await replaceGroup(id, body, baseUrl, ip);
  return { status: 200, body: r.resource, headers: { ETag: (r.resource.meta as { version: string }).version }, resourceId: id, summary: r.summary };
});

export const PATCH = scimHandler("Group", "patch", async ({ url, body, baseUrl, ip }) => {
  const id = idOf(url);
  const r = await patchGroup(id, body, baseUrl, ip);
  return { status: 200, body: r.resource, headers: { ETag: (r.resource.meta as { version: string }).version }, resourceId: id, summary: r.summary };
});

export const DELETE = scimHandler("Group", "delete", async ({ url, ip }) => {
  const id = idOf(url);
  const r = await deleteGroup(id, ip);
  return { status: 204, resourceId: id, summary: `Deleted group '${r.name}'` };
});
