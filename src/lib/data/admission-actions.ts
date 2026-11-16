import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { admissionApplications as apps, admissionDecisions, admissionReviews, applicants } from "@/lib/db/schema";
import { audit } from "@/lib/audit/log";
import type { Principal } from "@/lib/authz/principal";

export class ActionError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const FINAL = new Set(["admitted", "rejected"]);

async function lockApplication(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], id: string) {
  const [row] = await tx
    .select({ id: apps.id, status: apps.status, applicationNo: apps.applicationNo, name: sql<string>`${applicants.firstName} || ' ' || ${applicants.lastName}` })
    .from(apps)
    .innerJoin(applicants, eq(applicants.id, apps.applicantId))
    .where(eq(apps.id, id))
    .for("update", { of: apps });
  if (!row) throw new ActionError(404, "Application not found");
  return row;
}

export async function recordReview(
  principal: Principal,
  applicationId: string,
  input: { action: "start" } | { action: "note"; notes: string; recommendation?: "recommend_admission" | "recommend_rejection" | "requires_further_review" },
  ip: string | null,
) {
  return getDb().transaction(async (tx) => {
    const app = await lockApplication(tx, applicationId);
    if (FINAL.has(app.status)) throw new ActionError(409, "A final decision has already been recorded for this application.");
    const actor = { actorType: "user" as const, actorUserId: principal.user.id, actorLabel: principal.user.displayName, ipAddress: ip };
    const target = { targetType: "application", targetId: app.id, targetLabel: `${app.applicationNo} · ${app.name}` };

    if (input.action === "start") {
      if (app.status !== "submitted") throw new ActionError(409, "Review has already started for this application.");
      await tx.update(apps).set({ status: "under_review", updatedAt: new Date() }).where(eq(apps.id, app.id));
      await audit({ category: "admission", action: "application.review_started", ...actor, ...target, details: { from: app.status, to: "under_review" } }, tx);
      return { status: "under_review" };
    }

    let next = app.status;
    if (input.recommendation) next = "reviewed";
    else if (app.status === "submitted") next = "under_review";
    await tx.insert(admissionReviews).values({
      applicationId: app.id,
      reviewerId: principal.user.id,
      reviewerName: principal.user.displayName,
      recommendation: input.recommendation ?? null,
      notes: input.notes,
    });
    if (next !== app.status) await tx.update(apps).set({ status: next, updatedAt: new Date() }).where(eq(apps.id, app.id));
    await audit({
      category: "admission",
      action: input.recommendation ? "application.reviewed" : "application.review_note_added",
      ...actor,
      ...target,
      details: { recommendation: input.recommendation ?? null, from: app.status, to: next },
    }, tx);
    return { status: next };
  });
}

export async function recordDecision(principal: Principal, applicationId: string, decision: "approved" | "rejected" | "on_hold", reason: string | undefined, ip: string | null) {
  return getDb().transaction(async (tx) => {
    const app = await lockApplication(tx, applicationId);
    if (FINAL.has(app.status)) throw new ActionError(409, "A final decision has already been recorded for this application.");
    if (decision === "on_hold" && app.status === "on_hold") throw new ActionError(409, "The application is already on hold.");
    const next = decision === "approved" ? "admitted" : decision === "rejected" ? "rejected" : "on_hold";
    await tx.insert(admissionDecisions).values({
      applicationId: app.id, decision, decidedById: principal.user.id, decidedByName: principal.user.displayName, reason: reason || null,
    });
    await tx.update(apps).set({ status: next, updatedAt: new Date() }).where(eq(apps.id, app.id));
    await audit({
      category: "admission",
      action: decision === "approved" ? "admission.approved" : decision === "rejected" ? "admission.rejected" : "admission.placed_on_hold",
      actorType: "user", actorUserId: principal.user.id, actorLabel: principal.user.displayName, ipAddress: ip,
      targetType: "application", targetId: app.id, targetLabel: `${app.applicationNo} · ${app.name}`,
      details: { from: app.status, to: next, reason: reason || null, roles: principal.roles.map((r) => r.key) },
    }, tx);
    return { status: next };
  });
}
