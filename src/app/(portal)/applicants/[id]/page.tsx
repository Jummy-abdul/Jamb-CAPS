import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requirePage, can } from "@/lib/authz/principal";
import { getApplication } from "@/lib/data/admissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { ApplicationStatusBadge, Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ReviewPanel, DecisionPanel } from "@/components/admissions/action-panels";
import { formatDate, formatDateTime, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Applicant" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

export default async function ApplicantDetailPage({ params }: PageProps<"/applicants/[id]">) {
  const { id } = await params;
  const p = await requirePage("applicants.view", `/applicants/${id}`);
  const data = await getApplication(id);
  if (!data) notFound();
  const { app, applicant, institution, programme, reviews, decisions } = data;
  const name = [applicant.firstName, applicant.middleName, applicant.lastName].filter(Boolean).join(" ");

  return (
    <>
      <Link href="/applicants" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Applicants</Link>
      <PageHeader eyebrow={app.applicationNo} title={name} description={`${programme.name} · ${institution.name}`} actions={<ApplicationStatusBadge status={app.status} />} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Applicant information" />
            <dl className="grid gap-5 px-5 py-5 sm:grid-cols-3">
              <Field label="Registration no."><span className="font-mono text-xs">{applicant.registrationNo}</span></Field>
              <Field label="Email">{applicant.email}</Field>
              <Field label="Phone">{applicant.phone ?? "—"}</Field>
              <Field label="Gender">{applicant.gender}</Field>
              <Field label="Date of birth">{formatDate(applicant.dateOfBirth)}</Field>
              <Field label="State of origin">{applicant.stateOfOrigin}</Field>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Submitted application" />
            <dl className="grid gap-5 px-5 py-5 sm:grid-cols-3">
              <Field label="Institution">{institution.name}<p className="text-xs text-muted">{institution.type} · {institution.ownership} · {institution.state}</p></Field>
              <Field label="Programme">{programme.name}<p className="text-xs text-muted">Faculty of {programme.faculty}</p></Field>
              <Field label="Academic session">{app.academicSession}</Field>
              <Field label="UTME score"><span className="text-lg font-semibold tabular-nums">{applicant.utmeScore}</span><span className="text-xs text-muted"> / 400 · cut-off {programme.cutoffMark}</span></Field>
              <Field label="Post-UTME score">{app.postUtmeScore ?? "Not yet available"}</Field>
              <Field label="Aggregate">{app.aggregateScore ?? "—"}</Field>
              <Field label="Submitted">{formatDateTime(app.submittedAt)}</Field>
              <Field label="O&apos;Level">{applicant.oLevelSummary ?? "—"}</Field>
            </dl>
            <div className="border-t border-line px-5 py-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">UTME subject scores</p>
              <div className="flex flex-wrap gap-2">
                {applicant.utmeSubjects.map((s) => (
                  <span key={s.subject} className="rounded-lg border border-line bg-slate-50 px-3 py-1.5 text-xs">{s.subject} <b className="ml-1 tabular-nums">{s.score}</b></span>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Review history" description="Notes and recommendations recorded by reviewers" />
            {reviews.length === 0 ? (
              <EmptyState title="No reviews yet" description="This application has not been reviewed." />
            ) : (
              <ol className="divide-y divide-line">
                {reviews.map((r) => (
                  <li key={r.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{r.reviewerName}</span>
                      {r.recommendation && <Badge tone={r.recommendation === "recommend_admission" ? "green" : r.recommendation === "recommend_rejection" ? "red" : "amber"}>{humanize(r.recommendation)}</Badge>}
                      {r.isSample ? <Badge tone="gray">Sample</Badge> : <Badge tone="green">Live</Badge>}
                      <span className="ml-auto text-xs text-muted">{formatDateTime(r.createdAt)}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{r.notes}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Review" description="Requires the Review applications permission" />
            <div className="px-5 py-4">
              <ReviewPanel applicationId={app.id} status={app.status} canReview={can(p, "applications.review")} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Admission decision" description="Requires an admission decision permission" />
            <div className="px-5 py-4">
              <DecisionPanel
                applicationId={app.id}
                applicantName={name}
                status={app.status}
                allowed={{ approved: can(p, "admissions.approve"), rejected: can(p, "admissions.reject"), on_hold: can(p, "admissions.hold") }}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Decision history" />
            {decisions.length === 0 ? (
              <EmptyState title="No decision recorded" />
            ) : (
              <ol className="divide-y divide-line">
                {decisions.map((d) => (
                  <li key={d.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge tone={d.decision === "approved" ? "green" : d.decision === "rejected" ? "red" : "amber"}>{humanize(d.decision)}</Badge>
                      {d.isSample ? <Badge tone="gray">Sample</Badge> : <Badge tone="green">Live</Badge>}
                    </div>
                    <p className="mt-1">{d.decidedByName} · <span className="text-muted">{formatDateTime(d.createdAt)}</span></p>
                    {d.reason && <p className="mt-1 text-muted">{d.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
