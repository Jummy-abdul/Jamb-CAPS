import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Lock, AlertTriangle, Info, Mail, KeyRound } from "lucide-react";
import { getPrincipalResult } from "@/lib/authz/principal";
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
  const msg = reason ? MESSAGES[reason] : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Persistent fictional-demonstration disclaimer */}
      <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-navy-950">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        Demonstration environment — fictional data. Not an official JAMB system. Identity and access are managed by Fixiam.
      </div>

      {/* eFacility-style surface: soft light background with a centred login card */}
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10 sm:py-14">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-50 via-white to-green-50" aria-hidden />
        <div className="pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-green-200/30 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-28 -right-10 size-[30rem] rounded-full bg-green-100/40 blur-3xl" aria-hidden />

        {/* Login card */}
        <div className="relative w-full max-w-md rounded-2xl border border-green-100 bg-white shadow-[0_12px_44px_-14px_rgba(6,85,43,0.22)]">
          {/* JAMB crest (authorised customer demonstration) + product name */}
          <div className="flex flex-col items-center gap-2 border-b border-line px-8 pb-5 pt-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/jamb-logo.png" alt="Joint Admissions and Matriculation Board" width={80} height={75} className="h-20 w-auto" />
            <div className="text-center">
              <p className="text-base font-bold tracking-wide text-green-800">eFacility Demo</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Admissions &amp; Matriculation</p>
            </div>
          </div>

          <div className="px-8 py-7">
            <h1 className="text-xl font-semibold text-ink">Login to your account</h1>
            <span className="mt-2 block h-1 w-12 rounded-full bg-gold" aria-hidden />

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

            {/* Email + password — visual mockup only. Not wired to any backend; collects nothing. */}
            <div className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">Email Address</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="off"
                    placeholder="you@example.com"
                    className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-green-500 focus:ring-2 focus:ring-green-200"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">Password</label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="off"
                    placeholder="••••••••"
                    className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-green-500 focus:ring-2 focus:ring-green-200"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <a href="#" className="text-xs font-medium text-green-700 hover:text-green-800 hover:underline">Forgot your Password?</a>
              </div>

              {/* Original Login button — inert visual element in this demonstration */}
              <button
                type="button"
                className="flex h-12 w-full items-center justify-center rounded-lg bg-green-700 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300"
              >
                Login
              </button>
            </div>

            {/* Subtle OR divider */}
            <div className="my-5 flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-line" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted">or</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            {/* Fixiam SSO — the real authentication path */}
            <a
              href="/api/auth/login"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-green-700 bg-white text-sm font-semibold text-green-800 shadow-sm transition-colors hover:bg-green-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300"
            >
              <Lock className="size-4" aria-hidden />
              Login with Fixiam
            </a>
          </div>
        </div>
      </main>

      {/* Green footer bar (demo attribution — not JAMB) */}
      <footer className="bg-green-900 px-4 py-3 text-center text-xs font-medium text-green-50">
        © {new Date().getFullYear()} eFacility Demo — demonstration environment. Not an official JAMB system. Identity &amp; access by Fixiam (Seamfix).
      </footer>
    </div>
  );
}
