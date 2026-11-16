"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

export function AddMappingButton({ roles }: { roles: { key: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ sourceType: "group_display_name", sourceValue: "", roleKey: roles[0]?.key ?? "", description: "" });

  const submit = () =>
    start(async () => {
      const res = await fetch("/api/admin/role-mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ tone: "success", title: "Mapping created", message: `${data.recomputedUsers ?? 0} user(s) re-evaluated.` });
        setOpen(false);
        setForm((f) => ({ ...f, sourceValue: "", description: "" }));
        router.refresh();
      } else toast({ tone: res.status === 403 ? "warning" : "error", title: "Mapping not created", message: data.error });
    });

  const input = "mt-1 h-9 w-full rounded-lg border border-line bg-white px-3 text-sm focus:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-100";
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" />Add mapping</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add group-to-role mapping" description="Members of a matching Fixiam group will receive the selected CAPS role. Group membership itself is still managed in Fixiam.">
        <div className="space-y-3 text-sm">
          <label className="block"><span className="font-medium">Match groups by</span>
            <select className={input} value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })}>
              <option value="group_display_name">Group display name (case-insensitive)</option>
              <option value="group_external_id">Group externalId</option>
            </select>
          </label>
          <label className="block"><span className="font-medium">{form.sourceType === "group_display_name" ? "Group display name" : "Group externalId"}</span>
            <input className={input} value={form.sourceValue} onChange={(e) => setForm({ ...form, sourceValue: e.target.value })} placeholder={form.sourceType === "group_display_name" ? "e.g. CAPS Admission Officers – Lagos Zone" : "Fixiam group identifier"} />
          </label>
          <label className="block"><span className="font-medium">CAPS application role</span>
            <select className={input} value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
              {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </select>
          </label>
          <label className="block"><span className="font-medium">Description (optional)</span>
            <input className={input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending || form.sourceValue.trim().length < 1} onClick={submit}>Create mapping</Button>
        </div>
      </Dialog>
    </>
  );
}

export function ToggleMappingButton({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={enabled ? "secondary" : "primary"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await fetch(`/api/admin/role-mappings/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            toast({ tone: "success", title: enabled ? "Mapping disabled" : "Mapping enabled", message: `${data.recomputedUsers ?? 0} user(s) re-evaluated.` });
            router.refresh();
          } else toast({ tone: res.status === 403 ? "warning" : "error", title: "Change not applied", message: data.error });
        })
      }
    >
      {enabled ? "Disable" : "Enable"}
    </Button>
  );
}
