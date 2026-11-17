import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Lock, AlertTriangle, Info, ShieldCheck } from "lucide-react";
import { getPrincipalResult } from "@/lib/authz/principal";
import { getConfigStatus } from "@/lib/env";
import { CapsLogo } from "@/components/layout/logo";
import { sp } from "@/lib/utils";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, { tone: "info" | "warn" | "error"; text: string }> = {
  logged_out: { tone: "info", text: "You have been signed out." },
  session_expired: { tone: "info", text: "Your session has expired. Please sign in again." },
  idle_timeout: { tone: "info", text: "You were signed out after a period of inactivity." },
  session_revoked: { tone: "warn", text: "Your session was ended. Please sign in again." },
  account_inactive: { tone: "error", text: "Your access has been deactivated in Fixiam. Contact your administrator." },
  account_deprovisioned: { tone: "error", text: "Your account has been removed by Fixiam. Contact your administrator." },
  not_provisioned: { tone: "error", text: "You authenticated with Fixiam, but you have not been provisioned to eFacility. Ask your administrator to assign you the eFacility application in Fixiam." },
  email_unverified: { tone: "error", text: "Your email address has not been verified by Fixiam, so your account could not be linked. Verify your email in Fixiam and try again." },
  login_failed: { tone: "error", text: "Sign-in could not be completed. Please try again." },
  access_denied: { tone: "warn", text: "Sign-in was cancelled or denied at Fixiam." },
  not_configured: { tone: "error", text: "Fixiam Single Sign-On is not configured for this deployment yet." },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const s = await searchParams;
  const reason = sp(s.reason);
  // Preserved: already-authenticated users skip the login screen.
  const current = await getPrincipalResult().catch(() => null);
  if (current?.ok && !reason) redirect("/dashboard");
  const oidcReady = getConfigStatus().oidc.configured;
  const msg = reason ? MESSAGES[reason] : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-green-50">
      {/* Persistent fictional-demonstration disclaimer */}
      <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-navy-950">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        Demonstration environment — fictional data. Not an official JAMB system. Identity and access are managed by Fixiam.
      </div>

      {/* Main surface: soft background, faded watermark, centred login card */}
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10 sm:py-14">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-green-50 via-white to-green-100/70" aria-hidden />
        <div className="pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-green-200/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-28 -right-10 size-[30rem] rounded-full bg-green-300/25 blur-3xl" aria-hidden />
        <p
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 select-none text-[11rem] font-black uppercase leading-none tracking-tighter text-green-700/5 xl:block"
        >
          eFacility
        </p>

        {/* Login card */}
        <div className="relative w-full max-w-md rounded-2xl border border-green-100 bg-white shadow-[0_12px_44px_-14px_rgba(6,85,43,0.28)]">
          {/* Emblem + product name (demo mark — not the JAMB crest) */}
          <div className="flex flex-col items-center gap-2 border-b border-line px-8 pb-5 pt-8">
            <span className="grid size-16 place-items-center rounded-2xl bg-green-700 shadow-sm">
              <CapsLogo className="size-10" />
            </span>
            <div className="text-center">
              <p className="text-base font-bold tracking-wide text-green-800">eFacility Demo</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Admissions &amp; Matriculation · Fixiam IAM demonstration</p>
            </div>
          </div>

          <div className="px-8 py-7">
            <h1 className="text-xl font-semibold text-ink">Login to your account</h1>
            <span className="mt-2 block h-1 w-12 rounded-full bg-gold" aria-hidden />
            <p className="mt-3 text-sm text-muted">Sign in with your organisational identity, managed by Fixiam.</p>

            {msg && (
              <div
                role="alert"
                className={`mt-5 flex gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                  msg.tone === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : msg.tone === "warn"
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-green-200 bg-green-50 text-green-900"
                }`}
              >
                {msg.tone === "info" ? <Info className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
                <span>{msg.text}</span>
              </div>
            )}

            {oidcReady ? (
              <a
                href="/api/auth/login"
                className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-green-700 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300"
              >
                <Lock className="size-4" aria-hidden />
                Login with Fixiam
              </a>
            ) : (
              <div className="mt-6 rounded-lg border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">
                <p className="font-medium text-ink">Fixiam SSO not configured</p>
                <p className="mt-1">Set the FIXIAM_* environment variables to enable sign-in.</p>
              </div>
            )}

            <ul className="mt-6 space-y-2 text-xs text-muted">
              <li className="flex gap-2"><ShieldCheck className="size-4 shrink-0 text-green-600" aria-hidden />Single Sign-On through Fixiam — no separate password</li>
              <li className="flex gap-2"><ShieldCheck className="size-4 shrink-0 text-green-600" aria-hidden />Accounts provisioned automatically from Fixiam over SCIM 2.0</li>
              <li className="flex gap-2"><ShieldCheck className="size-4 shrink-0 text-green-600" aria-hidden />Roles and permissions governed centrally in Fixiam</li>
            </ul>

            <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-muted">
              Account or access issues? Contact your Fixiam administrator. This demonstration has no local passwords;
              authentication, provisioning and role assignment are performed centrally by Fixiam Identity and Access Management.
            </p>
          </div>
        </div>
      </main>

      {/* Green footer bar (demo attribution — not JAMB) */}
      <footer className="bg-green-800 px-4 py-3 text-center text-xs font-medium text-green-50">
        {new Date().getFullYear()} · eFacility Demo — demonstration environment. Not an official JAMB system. Identity &amp; access by Fixiam (Seamfix).
      </footer>
    </div>
  );
}
