import Link from "next/link";
import { Search } from "lucide-react";

/**
 * Plain GET form for search and filtering: works without client JavaScript and
 * keeps state in the URL so filtered views can be shared and bookmarked.
 */
export function FilterBar({
  basePath,
  q,
  placeholder = "Search…",
  selects = [],
}: {
  basePath: string;
  q?: string;
  placeholder?: string;
  selects?: { name: string; label: string; value?: string; options: { value: string; label: string }[] }[];
}) {
  const active = !!q || selects.some((s) => s.value);
  return (
    <form method="get" action={basePath} className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <label className="relative min-w-[240px] flex-1">
        <span className="sr-only">Search</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          className="h-9 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-navy-400 focus:ring-2 focus:ring-navy-100"
        />
      </label>
      {selects.map((s) => (
        <label key={s.name} className="text-sm">
          <span className="sr-only">{s.label}</span>
          <select
            name={s.name}
            defaultValue={s.value ?? ""}
            className="h-9 rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-navy-400 focus:ring-2 focus:ring-navy-100"
          >
            <option value="">{s.label}: All</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      ))}
      <button type="submit" className="h-9 rounded-lg bg-navy-800 px-4 text-sm font-medium text-white hover:bg-navy-700">Apply</button>
      {active && <Link href={basePath} className="h-9 rounded-lg px-3 text-sm leading-9 text-muted hover:text-ink">Clear</Link>}
    </form>
  );
}
