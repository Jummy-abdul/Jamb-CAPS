"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Toast = { id: number; tone: "success" | "error" | "warning"; title: string; message?: string };
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 5500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "warning" ? AlertTriangle : XCircle;
          return (
            <div key={t.id} className={cn("pointer-events-auto flex gap-3 rounded-xl border bg-white p-4 shadow-lg", t.tone === "success" ? "border-emerald-200" : t.tone === "warning" ? "border-amber-200" : "border-rose-200")}>
              <Icon className={cn("mt-0.5 size-5 shrink-0", t.tone === "success" ? "text-emerald-600" : t.tone === "warning" ? "text-amber-600" : "text-rose-600")} />
              <div>
                <p className="text-sm font-semibold text-ink">{t.title}</p>
                {t.message && <p className="mt-0.5 text-sm text-muted">{t.message}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
