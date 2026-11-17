import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck, Lock, AlertTriangle, Info } from "lucide-react";
import { getPrincipalResult } from "@/lib/authz/principal";
import { getConfigStatus } from "@/lib/env";
import { CapsLogo } from "@/components/layout/logo";
import { DemoBanner } from "@/components/layout/demo-banner";
import { sp } from "@/lib/utils";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, { tone: "info" | "warn" | "error"; text: string }> = {
  logged_out: { tone: "info", text: "You have been signed out of CAPS." },
  session_expired: { tone: "info", text: "Your session has expired. Please sign in again." },
  idle_timeout: { tone: "info", text: "You were signed out after a period of inactivity." },
  session_revoked: { tone: "warn", text: "Your session was ended. Please sign in again." },
  account_inactive: { tone: "error", text: "Your CAPS access has been deactivated in Fixiam. Contact your administrator." },
  account_deprovisioned: { tone: "error", text: "Your CAPS account has been removed by Fixiam. Contact your administrator." },
  not_provisioned: { tone: "error", text: "You authenticated with Fixiam, but you have not been provisioned to CAPS. Ask your administrator to assign you the CAPS application in Fixiam." },
  email_unverified: { tone: "error", text: "Your email address has not been verified by Fixiam, so CAPS could not link your account. Verify your email in Fixiam and try again." },
  login_failed: { tone: "error", text: "Sign-in could not be completed. Please try again." },
  access_denied: { tone: "warn", text: "Sign-in was cancelled or denied at Fixiam." },
  not_configured: { tone: "error", text: "Fixiam Single Sign-On is not configured for this deployment yet." },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const s = await searchParams;
  const reason = sp(s.reason);
  const current = await getPrincipalResult().catch(() => null);
  if (current?.ok && !reason) redirect("/dashboard");
  const oidcReady = getConfigStatus().oidc.configured;
  const msg = reason ? MESSAGES[reason] : undefined;

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <div className="grid flex-1 lg:grid-cols-[1.1fr_1fr]">
        <section className="relative hidden overflow-hidden bg-navy-900 px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-24 -top-24 size-96 rounded-full bg-navy-700/40 blur-3xl" aria-hidden />
          <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-emerald-700/20 blur-3xl" aria-hidden />
          <div className="relative flex items-center gap-3">
            <CapsLogo className="size-11" />
            <div>
              <p className="text-xl font-bold tracking-wide">CAPS</p>
              <p className="text-xs text-navy-300">Central Admission Processing System</p>
            </div>
          </div>
          <div className="relative max-w-lg">
            <h1 className="text-4xl font-semibold leading-tight">Admissions Administration and Processing Portal</h1>
            <p className="mt-4 text-navy-200">Review applications, record admission decisions and manage the admission exercise across participating institutions.</p>
            <ul className="mt-8 space-y-3 text-sm text-navy-100">
              <li className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-emerald-400" />Single Sign-On through Fixiam — no separate CAPS password</li>
              <li className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-emerald-400" />Accounts provisioned automatically from Fixiam over SCIM 2.0</li>
              <li className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-emerald-400" />Roles and permissions governed centrally in Fixiam</li>
            </ul>
          </div>
          <p className="relative text-xs text-navy-400">Demonstration application. All records are fictional. Not an official JAMB system.</p>
        </section>

        <section className="flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <span className="rounded-lg bg-navy-900 p-1"><CapsLogo className="size-9" /></span>
              <div><p className="text-lg font-bold text-navy-900">CAPS</p><p className="text-xs text-muted">Central Admission Processing System</p></div>
            </div>
            <h2 className="text-2xl font-semibold text-ink">Sign in</h2>
            <p className="mt-1 text-sm text-muted">Use your organisational identity managed by Fixiam.</p>

            {msg && (
              <div className={`mt-6 flex gap-2 rounded-lg border px-3 py-2.5 text-sm ${msg.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : msg.tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-navy-100 bg-navy-50 text-navy-800"}`}>
                {msg.tone === "info" ? <Info className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
                <span>{msg.text}</span>
              </div>
            )}

            {oidcReady ? (
              <a href="/api/auth/login" className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-navy-800 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-700 focus:outline-none focus:ring-2 focus:ring-navy-300">
                <Lock className="size-4" />
                Login with Fixiam
              </a>
            ) : (
              <div className="mt-6 rounded-lg border border-dashed border-line p-4 text-sm text-muted">
                <p className="font-medium text-ink">Fixiam SSO not configured</p>
                <p className="mt-1">Set the FIXIAM_* environment variables to enable sign-in.</p>
              </div>
            )}
            <p className="mt-6 text-xs leading-relaxed text-muted">
              CAPS has no local passwords. Authentication, account provisioning and role assignment are performed centrally by Fixiam Identity and Access Management.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
