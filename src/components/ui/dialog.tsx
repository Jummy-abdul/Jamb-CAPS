"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/** Accessible modal dialog built on the native <dialog> element. */
export function Dialog({ open, onClose, title, description, children }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-navy-950/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-slate-100 hover:text-ink" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
