import { scimHandler, project } from "@/lib/scim/handler";
import { deleteUser, getUser, patchUser, replaceUser } from "@/lib/scim/users";

export const dynamic = "force-dynamic";

const idOf = (url: URL) => decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");

export const GET = scimHandler("User", "get", async ({ url, baseUrl }) => {
  const id = idOf(url);
  const user = await getUser(id, baseUrl);
  return { status: 200, body: project(user, url), resourceId: id, summary: `Retrieved user '${user.userName}'` };
});

export const PUT = scimHandler("User", "replace", async ({ url, body, baseUrl, ip }) => {
  const id = idOf(url);
  const user = await replaceUser(id, body, baseUrl, ip);
  return { status: 200, body: user, headers: { ETag: (user.meta as { version: string }).version }, resourceId: id, summary: `Replaced user '${user.userName}' (active: ${user.active})` };
});

export const PATCH = scimHandler("User", "patch", async ({ url, body, baseUrl, ip }) => {
  const id = idOf(url);
  const user = await patchUser(id, body, baseUrl, ip);
  return { status: 200, body: user, headers: { ETag: (user.meta as { version: string }).version }, resourceId: id, summary: `Patched user '${user.userName}' (active: ${user.active})` };
});

export const DELETE = scimHandler("User", "delete", async ({ url, ip }) => {
  const id = idOf(url);
  const r = await deleteUser(id, ip);
  return { status: 204, resourceId: id, summary: `Deprovisioned user '${r.label}'` };
});
