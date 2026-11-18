import "server-only";
import { and, count, desc, eq, gte, ilike, lt, or, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLogs, scimSyncLogs } from "@/lib/db/schema";

export const LOG_PAGE_SIZE = 25;

export const AUDIT_CATEGORIES = ["provisioning", "group", "authorization", "authentication", "session", "admission", "configuration", "system"] as const;

export async function listAuditLogs(opts: { q?: string; category?: string; outcome?: string; target?: string; page: number; pageSize?: number }) {
  const db = getDb();
  const size = opts.pageSize ?? LOG_PAGE_SIZE;
  const where: SQL[] = [];
  if (opts.q) {
    const like = `%${opts.q}%`;
    where.push(or(ilike(auditLogs.action, like), ilike(auditLogs.actorLabel, like), ilike(auditLogs.targetLabel, like), ilike(auditLogs.targetId, like))!);
  }
  if (opts.category && (AUDIT_CATEGORIES as readonly string[]).includes(opts.category)) where.push(eq(auditLogs.category, opts.category));
  if (opts.outcome === "success" || opts.outcome === "denied" || opts.outcome === "failure") where.push(eq(auditLogs.outcome, opts.outcome));
  if (opts.target) where.push(eq(auditLogs.targetId, opts.target));
  const cond = where.length ? and(...where) : undefined;
  const rows = await db.select().from(auditLogs).where(cond).orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id)).limit(size).offset((opts.page - 1) * size);
  const [{ n }] = await db.select({ n: count() }).from(auditLogs).where(cond);
  return { rows, total: n, pageSize: size };
}

export async function listScimLogs(opts: { q?: string; resource?: string; result?: string; page: number }) {
  const db = getDb();
  const where: SQL[] = [];
  if (opts.q) {
    const like = `%${opts.q}%`;
    where.push(or(ilike(scimSyncLogs.summary, like), ilike(scimSyncLogs.path, like), ilike(scimSyncLogs.resourceId, like))!);
  }
  if (opts.resource === "User" || opts.resource === "Group") where.push(eq(scimSyncLogs.resourceType, opts.resource));
  if (opts.result === "ok") where.push(and(gte(scimSyncLogs.statusCode, 200), lt(scimSyncLogs.statusCode, 400))!);
  if (opts.result === "error") where.push(gte(scimSyncLogs.statusCode, 400));
  const cond = where.length ? and(...where) : undefined;
  const rows = await db.select().from(scimSyncLogs).where(cond).orderBy(desc(scimSyncLogs.occurredAt), desc(scimSyncLogs.id)).limit(LOG_PAGE_SIZE).offset((opts.page - 1) * LOG_PAGE_SIZE);
  const [{ n }] = await db.select({ n: count() }).from(scimSyncLogs).where(cond);
  return { rows, total: n };
}

export async function getScimLog(id: number) {
  const [row] = await getDb().select().from(scimSyncLogs).where(eq(scimSyncLogs.id, id));
  return row ?? null;
}
