import "server-only";
import { getDb, type Tx } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema";

export type AuditCategory =
  | "provisioning"
  | "group"
  | "authorization"
  | "authentication"
  | "session"
  | "admission"
  | "configuration"
  | "system";

export interface AuditEntry {
  category: AuditCategory;
  action: string;
  outcome?: "success" | "denied" | "failure";
  actorType: "user" | "fixiam_scim" | "fixiam_oidc" | "system" | "anonymous";
  actorUserId?: string | null;
  actorLabel: string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

const SENSITIVE_KEYS = /pass(word)?|secret|token|authorization|cookie|code_verifier|id_token|access_token|refresh_token/i;

/** Remove anything that looks like a credential before it is persisted. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/**
 * Append an audit record. Pass `tx` to make the audit record part of the same
 * transaction as the change it describes (it then commits or rolls back with it).
 */
export async function audit(entry: AuditEntry, tx?: Tx): Promise<void> {
  const db = tx ?? getDb();
  await db.insert(auditLogs).values({
    category: entry.category,
    action: entry.action,
    outcome: entry.outcome ?? "success",
    actorType: entry.actorType,
    actorUserId: entry.actorUserId ?? null,
    actorLabel: entry.actorLabel,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    targetLabel: entry.targetLabel ?? null,
    details: entry.details ? redact(entry.details) : null,
    ipAddress: entry.ipAddress ?? null,
  });
}

/** Best-effort audit for paths where failing to audit must not mask the original outcome. */
export async function auditSafe(entry: AuditEntry): Promise<void> {
  try {
    await audit(entry);
  } catch (e) {
    console.error("[audit] failed to write audit record", entry.action, e instanceof Error ? e.message : e);
  }
}

export const SCIM_ACTOR = { actorType: "fixiam_scim" as const, actorLabel: "Fixiam (SCIM provisioning)" };
