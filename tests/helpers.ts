import postgres from "postgres";

export const TOKEN = process.env.SCIM_TOKEN!;
export const BASE = "https://caps.test";

export async function resetDb() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  // audit_logs is append-only via trigger; tests disable triggers for cleanup only.
  await sql.unsafe(`
    set session_replication_role = replica;
    truncate audit_logs, scim_sync_logs, user_sessions, oidc_transactions, user_entitlements, group_memberships,
             admission_decisions, admission_reviews, admission_applications, applicants, programmes, institutions,
             groups, users restart identity cascade;
    set session_replication_role = origin;
    update role_mappings set enabled = true;
    delete from role_mappings where created_by <> 'system';
  `);
  await sql.end();
}

export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    return (await sql.unsafe(text, params as never[])) as unknown as T[];
  } finally {
    await sql.end();
  }
}

type Handler = (req: Request) => Promise<Response>;

export async function call(handler: Handler, method: string, path: string, body?: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = { "Content-Type": "application/scim+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handler(new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

export const PATCH_OP = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
