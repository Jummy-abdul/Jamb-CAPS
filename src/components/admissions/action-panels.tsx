"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, PauseCircle, PlayCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const FINAL = ["admitted", "rejected"];

export function ReviewPanel({ applicationId, status, canReview }: { applicationId: string; status: string; canReview: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState("");
  const [recommendation, setRecommendation] = useState("");

  if (!canReview) {
    return <LockedNotice text="Your CAPS role does not include reviewing applications." />;
  }
  if (FINAL.includes(status)) {
    return <p className="text-sm text-muted">A final decision has been recorded. The application is closed for review.</p>;
  }

  const submit = (body: Record<string, unknown>, success: string) =>
    start(async () => {
      const r = await post(`/api/applications/${applicationId}/review`, body);
      if (r.ok) {
        toast({ tone: "success", title: success });
        setNotes("");
        setRecommendation("");
        router.refresh();
      } else {
        toast({ tone: r.status === 403 ? "warning" : "error", title: r.status === 403 ? "Access denied" : "Could not save review", message: r.data.error });
        if (r.status === 401) router.push("/login?reason=session_revoked");
      }
    });

  return (
    <div className="space-y-4">
      {status === "submitted" && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
          <p className="text-sm text-violet-900">This application has not been picked up for review.</p>
          <Button size="sm" disabled={pending} onClick={() => submit({ action: "start" }, "Review started")}>
            <PlayCircle className="size-4" />Start review
          </Button>
        </div>
      )}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit({ action: "note", notes, recommendation: recommendation || undefined }, recommendation ? "Review recorded" : "Review note added");
        }}
      >
        <label className="block text-sm">
          <span className="font-medium text-ink">Recommendation</span>
          <select value={recommendation} onChange={(e) => setRecommendation(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line bg-white px-3 text-sm focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-100">
            <option value="">Note only (no recommendation yet)</option>
            <option value="recommend_admission">Recommend admission</option>
            <option value="recommend_rejection">Recommend rejection</option>
            <option value="requires_further_review">Requires further review</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-ink">Review notes</span>
          <textarea
            required
            minLength={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Record verification findings, observations and justification…"
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-100"
          />
        </label>
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || notes.trim().length < 3}>{recommendation ? "Submit review" : "Add note"}</Button>
        </div>
      </form>
    </div>
  );
}

type Decision = "approved" | "rejected" | "on_hold";
const DECISION_UI: Record<Decision, { label: string; verb: string; variant: "success" | "danger" | "warning"; icon: typeof CheckCircle2 }> = {
  approved: { label: "Approve admission", verb: "approve admission for", variant: "success", icon: CheckCircle2 },
  rejected: { label: "Reject", verb: "reject the application of", variant: "danger", icon: XCircle },
  on_hold: { label: "Place on hold", verb: "place on hold the application of", variant: "warning", icon: PauseCircle },
};

export function DecisionPanel({ applicationId, applicantName, status, allowed }: { applicationId: string; applicantName: string; status: string; allowed: Record<Decision, boolean> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const anyAllowed = Object.values(allowed).some(Boolean);

  if (FINAL.includes(status)) {
    return <p className="text-sm text-muted">A final admission decision has been recorded for this application.</p>;
  }

  const confirm = () =>
    start(async () => {
      if (!open) return;
      const r = await post(`/api/applications/${applicationId}/decision`, { decision: open, reason });
      setOpen(null);
      setReason("");
      if (r.ok) {
        toast({ tone: "success", title: "Decision recorded", message: `${DECISION_UI[open].label} — ${applicantName}` });
        router.refresh();
      } else {
        toast({ tone: r.status === 403 ? "warning" : "error", title: r.status === 403 ? "Access denied" : "Decision not recorded", message: r.data.error });
        if (r.status === 401) router.push("/login?reason=session_revoked");
      }
    });

  return (
    <div className="space-y-3">
      {!anyAllowed && <LockedNotice text="Your CAPS role does not include admission decisions. Decisions require the Admission Manager role assigned through Fixiam." />}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(DECISION_UI) as Decision[]).map((d) => {
          const ui = DECISION_UI[d];
          const Icon = ui.icon;
          return (
            // Buttons are shown to everyone so the denial (enforced by the API) can be demonstrated.
            <Button key={d} variant={allowed[d] ? ui.variant : "secondary"} disabled={pending || (d === "on_hold" && status === "on_hold")} onClick={() => setOpen(d)} title={allowed[d] ? undefined : "Not permitted for your role"}>
              {allowed[d] ? <Icon className="size-4" /> : <Lock className="size-4" />}
              {ui.label}
            </Button>
          );
        })}
      </div>
      <Dialog open={open !== null} onClose={() => setOpen(null)} title={open ? DECISION_UI[open].label : ""} description={open ? `You are about to ${DECISION_UI[open].verb} ${applicantName}. This action is recorded in the audit log.` : undefined}>
        <label className="block text-sm">
          <span className="font-medium">Reason {open === "approved" ? "(optional)" : ""}</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-100" placeholder="Decision justification" />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(null)}>Cancel</Button>
          <Button variant={open ? DECISION_UI[open].variant : "primary"} disabled={pending || (open !== "approved" && reason.trim().length < 3)} onClick={confirm}>Confirm</Button>
        </div>
      </Dialog>
    </div>
  );
}

function LockedNotice({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-slate-50 px-4 py-3 text-sm text-muted">
      <Lock className="mt-0.5 size-4 shrink-0" />
      {text}
    </div>
  );
}
