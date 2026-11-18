import { FlaskConical } from "lucide-react";

export function DemoBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-navy-950">
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      Demonstration environment — fictional data. Not an official JAMB system. Identity and access are managed by Fixiam.
    </div>
  );
}
