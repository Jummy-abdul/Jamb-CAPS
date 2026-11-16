import "server-only";
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  admissionApplications as apps,
  admissionDecisions,
  admissionReviews,
  applicants,
  applicationStatus,
  institutions,
  programmes,
} from "@/lib/db/schema";

export type ApplicationStatus = (typeof applicationStatus.enumValues)[number];
export const PAGE_SIZE = 15;

export async function getDashboardStats() {
  const db = getDb();
  const rows = await db.select({ status: apps.status, n: count() }).from(apps).groupBy(apps.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<ApplicationStatus, number>>;
  const total = rows.reduce((a, r) => a + r.n, 0);
  const [{ n: institutionCount }] = await db.select({ n: count() }).from(institutions);
  const byInstitution = await db
    .select({ name: institutions.name, code: institutions.code, total: count(), admitted: sql<number>`count(*) filter (where ${apps.status} = 'admitted')::int` })
    .from(apps)
    .innerJoin(institutions, eq(institutions.id, apps.institutionId))
    .groupBy(institutions.name, institutions.code)
    .orderBy(desc(count()));
  return {
    total,
    underReview: (by.under_review ?? 0) + (by.submitted ?? 0),
    offers: by.admitted ?? 0,
    pendingDecisions: (by.reviewed ?? 0) + (by.on_hold ?? 0),
    rejected: by.rejected ?? 0,
    institutions: institutionCount,
    byStatus: by,
    byInstitution,
  };
}

export async function getRecentAdmissionActivity(limit = 8) {
  const db = getDb();
  const reviews = await db
    .select({
      at: admissionReviews.createdAt, actor: admissionReviews.reviewerName, kind: sql<string>`'review'`,
      detail: admissionReviews.recommendation, applicationNo: apps.applicationNo, applicationId: apps.id,
      applicant: sql<string>`${applicants.firstName} || ' ' || ${applicants.lastName}`, isSample: admissionReviews.isSample,
    })
    .from(admissionReviews)
    .innerJoin(apps, eq(apps.id, admissionReviews.applicationId))
    .innerJoin(applicants, eq(applicants.id, apps.applicantId))
    .orderBy(desc(admissionReviews.createdAt))
    .limit(limit);
  const decisions = await db
    .select({
      at: admissionDecisions.createdAt, actor: admissionDecisions.decidedByName, kind: sql<string>`'decision'`,
      detail: sql<string>`${admissionDecisions.decision}::text`, applicationNo: apps.applicationNo, applicationId: apps.id,
      applicant: sql<string>`${applicants.firstName} || ' ' || ${applicants.lastName}`, isSample: admissionDecisions.isSample,
    })
    .from(admissionDecisions)
    .innerJoin(apps, eq(apps.id, admissionDecisions.applicationId))
    .innerJoin(applicants, eq(applicants.id, apps.applicantId))
    .orderBy(desc(admissionDecisions.createdAt))
    .limit(limit);
  return [...reviews, ...decisions].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

export async function listInstitutions() {
  return getDb().select({ id: institutions.id, code: institutions.code, name: institutions.name }).from(institutions).orderBy(institutions.name);
}

export async function listApplications(opts: { q?: string; status?: string; institution?: string; statuses?: ApplicationStatus[]; page: number; pageSize?: number }) {
  const db = getDb();
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const where: SQL[] = [];
  if (opts.q) {
    const like = `%${opts.q}%`;
    where.push(
      or(
        ilike(apps.applicationNo, like),
        ilike(applicants.registrationNo, like),
        ilike(applicants.email, like),
        sql`(${applicants.firstName} || ' ' || coalesce(${applicants.middleName} || ' ', '') || ${applicants.lastName}) ilike ${like}`,
        ilike(programmes.name, like),
      )!,
    );
  }
  if (opts.status && (applicationStatus.enumValues as readonly string[]).includes(opts.status)) where.push(eq(apps.status, opts.status as ApplicationStatus));
  if (opts.statuses?.length) where.push(inArray(apps.status, opts.statuses));
  if (opts.institution) where.push(eq(institutions.code, opts.institution));
  const cond = where.length ? and(...where) : undefined;

  const base = db
    .select({
      id: apps.id,
      applicationNo: apps.applicationNo,
      status: apps.status,
      submittedAt: apps.submittedAt,
      updatedAt: apps.updatedAt,
      utmeScore: applicants.utmeScore,
      aggregateScore: apps.aggregateScore,
      name: sql<string>`${applicants.firstName} || ' ' || ${applicants.lastName}`,
      email: applicants.email,
      institution: institutions.name,
      institutionCode: institutions.code,
      programme: programmes.name,
    })
    .from(apps)
    .innerJoin(applicants, eq(applicants.id, apps.applicantId))
    .innerJoin(institutions, eq(institutions.id, apps.institutionId))
    .innerJoin(programmes, eq(programmes.id, apps.programmeId))
    .where(cond);

  const rows = await base.orderBy(desc(apps.submittedAt)).limit(pageSize).offset((opts.page - 1) * pageSize);
  const [{ n }] = await db
    .select({ n: count() })
    .from(apps)
    .innerJoin(applicants, eq(applicants.id, apps.applicantId))
    .innerJoin(institutions, eq(institutions.id, apps.institutionId))
    .innerJoin(programmes, eq(programmes.id, apps.programmeId))
    .where(cond);
  return { rows, total: n, pageSize };
}

export async function getApplication(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDb();
  const [row] = await db
    .select({ app: apps, applicant: applicants, institution: institutions, programme: programmes })
    .from(apps)
    .innerJoin(applicants, eq(applicants.id, apps.applicantId))
    .innerJoin(institutions, eq(institutions.id, apps.institutionId))
    .innerJoin(programmes, eq(programmes.id, apps.programmeId))
    .where(eq(apps.id, id));
  if (!row) return null;
  const reviews = await db.select().from(admissionReviews).where(eq(admissionReviews.applicationId, id)).orderBy(desc(admissionReviews.createdAt));
  const decisions = await db.select().from(admissionDecisions).where(eq(admissionDecisions.applicationId, id)).orderBy(desc(admissionDecisions.createdAt));
  return { ...row, reviews, decisions };
}
