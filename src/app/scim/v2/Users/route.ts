import { scimHandler, pagination } from "@/lib/scim/handler";
import { createUser, listUsers } from "@/lib/scim/users";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/scim/constants";
import { project } from "@/lib/scim/handler";

export const dynamic = "force-dynamic";

export const GET = scimHandler("User", "list", async ({ url, baseUrl }) => {
  const { startIndex, count } = pagination(url, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const filter = url.searchParams.get("filter");
  const list = await listUsers(filter, startIndex, count, baseUrl);
  return {
    status: 200,
    body: { ...list, Resources: list.Resources.map((r) => project(r, url)) },
    summary: `Listed users${filter ? ` (filter: ${filter})` : ""}: ${list.itemsPerPage} of ${list.totalResults}`,
  };
});

export const POST = scimHandler("User", "create", async ({ body, baseUrl, ip }) => {
  const user = await createUser(body, baseUrl, ip);
  return {
    status: 201,
    body: user,
    headers: { Location: (user.meta as { location: string }).location, ETag: (user.meta as { version: string }).version },
    resourceId: user.id as string,
    summary: `Provisioned user '${user.userName}'`,
  };
});
