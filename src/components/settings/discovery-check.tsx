"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Result = { ok: boolean; error?: string; issuer?: string; endpoints?: Record<string, string | undefined>; supports?: Record<string, unknown> };

export function DiscoveryCheck() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  return (
    <div className="space-y-3">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => {
        const res = await fetch("/api/admin/oidc-check", { cache: "no-store" });
        setResult(await res.json().catch(() => ({ ok: false, error: "Unexpected response" })));
      })}>
        {pending ? "Checking…" : "Verify Fixiam discovery document"}
      </Button>
      {result && (
        result.ok ? (
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs">
            <p><Badge tone="green">Reachable</Badge> <span className="ml-1 font-mono">{result.issuer}</span></p>
            <dl className="grid gap-1">
              {Object.entries(result.endpoints ?? {}).map(([k, v]) => (
                <div key={k} className="flex gap-2"><dt className="w-48 shrink-0 text-muted">{k}</dt><dd className="break-all font-mono">{v ?? "not advertised"}</dd></div>
              ))}
              {Object.entries(result.supports ?? {}).map(([k, v]) => (
                <div key={k} className="flex gap-2"><dt className="w-48 shrink-0 text-muted">{k}</dt><dd className="break-all font-mono">{Array.isArray(v) ? v.join(", ") : String(v ?? "not advertised")}</dd></div>
              ))}
            </dl>
          </div>
        ) : (
          <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{result.error}</p>
        )
      )}
    </div>
  );
}
